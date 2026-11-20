// Agency pricing switches (no imports: safe to use from any module, including at load time).
// Unframed option for agents (Reece, 20 Nov 2026: £39, same ~£23 profit as framed at £75).
// Off until Stripe can create checkouts for us (restricted key: Checkout Sessions Write) and unframed packaging is sorted.
export const AGENT_UNFRAMED = false;
export const AGENT_UNFRAMED_PENCE = 3900;
// Wording used in agent emails, so both options read the same everywhere.
export const AGENT_PRICES = AGENT_UNFRAMED
  ? '£75 framed (then £65 after your first order) or £39 as an unframed A3 print, paid per print with no contract'
  : '£75 a print, then £65 a print after your first order, paid per print with no contract';
