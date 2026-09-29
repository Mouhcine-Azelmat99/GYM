export function goToCheckout(result) {
  if (!result.url) return false;
  const url = new URL(result.url);
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') {
    throw new Error('The payment provider returned an unexpected checkout address.');
  }
  window.location.assign(url.href);
  return true;
}
