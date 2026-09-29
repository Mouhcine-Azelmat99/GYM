import { z } from 'zod';
import { hash, id } from './domain.js';

export async function bootstrapOwner(store, { demo, env = process.env }) {
  const state = await store.read();
  const owner = state.users.find(user => user.role === 'owner');
  // Environment credentials bootstrap accounts; they never reset existing ones.
  if (owner?.passwordHash) return;
  if (demo && !env.OWNER_EMAIL && !env.OWNER_PASSWORD) return;

  const parsed = z.object({
    email: z.string().trim().email().transform(value => value.toLowerCase()),
    password: z.string().min(12).max(128),
  }).safeParse({ email: env.OWNER_EMAIL, password: env.OWNER_PASSWORD });
  if (!parsed.success) {
    throw new Error('Set OWNER_EMAIL to a valid email and OWNER_PASSWORD to 12–128 characters to initialize the owner account.');
  }
  const { email, password } = parsed.data;
  const passwordHash = hash(password);
  await store.mutate(state => {
    const currentOwner = state.users.find(user => user.role === 'owner');
    if (currentOwner?.passwordHash) return;
    if (state.users.some(user => user.email === email && user.id !== currentOwner?.id)) {
      throw new Error('The configured owner email belongs to another account. Choose a different owner email.');
    }
    if (currentOwner) {
      currentOwner.email = email;
      currentOwner.passwordHash = passwordHash;
    } else {
      state.users.push({ id: id(), name: 'Gym owner', email, role: 'owner', passwordHash });
    }
  });
}
