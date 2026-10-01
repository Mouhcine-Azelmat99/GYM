
import {useTranslation} from 'react-i18next';
import { useEffect, useState } from 'react';
import { Download, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { Button, Panel, Status, Empty } from '../components/ui';
import { api, date, money } from '../api';
import { PageHeading } from './Management';
import { goToCheckout } from '../checkout';

function CheckoutReturn({ state, refresh }) {const {t}=useTranslation();
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const paymentId = params.get('payment');
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const payment = state.payments.find(p => p.id === paymentId);
  const status = payment?.status;
  const visible = !dismissed && ['success', 'cancelled'].includes(params.get('checkout'));

  useEffect(() => {
    if (!visible || !payment || !state.onlineEnabled || ['paid', 'failed', 'expired'].includes(status)) return;
    let stopped = false, timer, count = 0;
    async function poll() {
      setChecking(true);
      setError('');
      try {
        const result = await api(`/payments/${encodeURIComponent(paymentId)}/reconcile`, {});
        if (stopped) return;
        await refresh();
        if (stopped) return;
        if (['paid', 'failed', 'expired'].includes(result.status)) return;
        count++;
        if (count < 15 && params.get('checkout') === 'success') timer = setTimeout(poll, 2000);
      } catch (e) {
        if (!stopped) setError(e.message);
      } finally {
        if (!stopped) setChecking(false);
      }
    }
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [visible, paymentId, Boolean(payment), status, state.onlineEnabled, refresh, attempt, params]);

  if (!visible) return null;
  const title = status === 'paid' ? t("Payment confirmed. Your membership is ready.")
    : status === 'failed' ? t("The payment failed. You can try again below.")
    : status === 'expired' ? t("This checkout expired. You can start a new checkout below.")
    : !payment ? t("This purchase is not available in this account.")
    : params.get('checkout') === 'cancelled' ? t("You returned from checkout. Your purchase is saved.")
    : t("Waiting for payment confirmation.");
  return <section className="payment-notice" aria-live="polite"><ShieldCheck size={21}/><div><strong>{title}</strong><p>{error || (status === 'processing' ? t("Your payment method is still processing. We’ll activate the membership after confirmation.") : status === 'paid' ? t("Your receipt is available in the payment history below.") : t('A return from checkout does not confirm a charge. Your payment status is verified with Stripe.'))}</p>{payment && !['paid', 'failed', 'expired'].includes(status) && <Button disabled={checking || !state.onlineEnabled} onClick={() => setAttempt(n => n + 1)}>{checking ? t("Checking…") : t("Check payment status")}</Button>}</div><button className="icon-button" aria-label={t("Dismiss checkout status")} onClick={() => {
    const url = new URL(window.location.href);url.searchParams.delete('checkout');url.searchParams.delete('payment');history.replaceState(null, '', url);setDismissed(true);
  }}><X size={17}/></button></section>;
}

export default function Payments({ state, open, refresh }) {const {t}=useTranslation();
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const rows = state.payments.filter(p => filter === 'all' || p.status === filter).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total = statuses => state.payments.filter(p => statuses.includes(p.status)).reduce((n, p) => n + p.amount, 0);
  async function updatePayment(payment, action) {
    setBusy(payment.id);setError('');
    try {
      const result = await api(`/payments/${payment.id}/${action}`, {});
      if (action === 'checkout' && goToCheckout(result)) return;
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }
  function exportCsv() {
    const quote = value => '"' + String(value ?? '').replace(/^[=+@-]/, "'").replaceAll('"', '""') + '"';
    const records = [[t("Member"), t("Description"), t("Amount (minor units)"), t("Currency"), t("Method"), t("Status"), t("Date")], ...rows.map(p => [state.members.find(m => m.id === p.memberId)?.name, p.description, p.amount, p.currency, p.method, p.status, p.createdAt])];
    const url = URL.createObjectURL(new Blob(['\uFEFF'+records.map(r => r.map(quote).join(',')).join('\r\n')], { type: 'text/csv' }));
    const link = document.createElement('a');link.href = url;link.download = 'forma-payments.csv';link.click();URL.revokeObjectURL(url);
  }
  return <>
    <PageHeading title={t("Payments, in one place.")} subtitle={t("A clear record of every membership payment.")}><Button onClick={exportCsv}><Download size={16}/>{t("Export CSV")}</Button><Button onClick={async () => { try { await refresh(); } catch (e) { setError(e.message); } }}><RefreshCw size={16}/>{t("Refresh")}</Button>{state.user.role !== 'member' && <Button variant="primary" onClick={() => open('purchase')}><Plus size={16}/>{t("Record purchase")}</Button>}</PageHeading>
    <CheckoutReturn state={state} refresh={refresh}/>
    {error && <div className="form-error" role="alert">{t(error)}</div>}
    <div className="metrics payment-metrics">{[[t("Total collected"), total(['paid'])], [t("Awaiting payment"), total(['pending', 'processing'])]].map(([label, value]) => <section className="metric" key={label}><div>{label}</div><strong>{money(value, state.settings.currency)}</strong></section>)}<section className="metric"><div>{t("Online checkout")}</div><strong className="small-stat">{state.onlineEnabled ? (state.paymentMode === 'test' ? t("Stripe test mode") : t("Stripe live mode")) : t("Setup required")}</strong><small>{state.onlineEnabled ? (state.paymentMode === 'test' ? t("Test payments only. No real charges.") : t("Secure checkout with Stripe")) : t(state.paymentSetupReason||'')}</small></section></div>
    <Panel><div className="list-toolbar"><div className="tabs">{['all', 'paid', 'pending', 'processing', 'failed', 'expired'].map(f => <button key={f} className={f === filter ? 'selected' : ''} onClick={() => setFilter(f)}>{f === 'all' ? t("All payments") : t(f)}</button>)}</div><span className="quiet">{t('transactions',{count:rows.length})}</span></div><div className="table-scroll"><table><thead><tr><th>{t("Member / purchase")}</th><th>{t("Amount")}</th><th>{t("Method")}</th><th>{t("Status")}</th><th>{t("Date")}</th><th>{t("Action")}</th></tr></thead><tbody>{rows.map(p => <tr key={p.id}><td><strong><bdi>{state.members.find(m => m.id === p.memberId)?.name}</bdi></strong><small className="cell-sub"><bdi>{p.description}</bdi></small></td><td className="amount">{money(p.amount, p.currency)}</td><td className="capitalize">{t(p.method)}</td><td><Status value={p.status}/></td><td>{date(p.createdAt)}</td><td>{p.status === 'paid' ? <Button onClick={() => open('receipt', p)}>{t("Receipt")}</Button> : p.method === 'cash' ? state.user.role === 'member' ? <span className="quiet">{t("Pay at reception")}</span> : <Button onClick={() => open('confirmPayment', p)}>{t("Confirm cash")}</Button> : <Button disabled={!state.onlineEnabled || busy === p.id} onClick={() => updatePayment(p, p.status === 'processing' ? 'reconcile' : 'checkout')}>{busy === p.id ? t("Please wait…") : p.status === 'processing' ? t("Check status") : ['failed', 'expired'].includes(p.status) ? t("Retry payment") : t("Pay online")}</Button>}</td></tr>)}</tbody></table>{!rows.length && <Empty>{t("No payments to display.")}</Empty>}</div></Panel>
  </>;
}
