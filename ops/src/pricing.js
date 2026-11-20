// Agency pricing switches (no imports: safe to use from any module, including at load time).
// Unframed option for agents (Reece, 20 Nov 2026: £39). Unframed prints are Hahnemühle Photo Rag 308gsm cotton (rolled in a tube).
export const AGENT_UNFRAMED = true;
export const AGENT_UNFRAMED_PENCE = 3900;
// Wording used in agent emails, so both options read the same everywhere.
export const AGENT_PRICES = AGENT_UNFRAMED
  ? '£75 framed (then £65 after your first order) or £39 as an unframed A3 print on heavyweight cotton paper, paid per print with no contract'
  : '£75 a print, then £65 a print after your first order, paid per print with no contract';
export const PAPER_UNFRAMED = 'heavyweight 308gsm cotton art paper (Hahnemühle Photo Rag)';

// Free office samples (from 20 Nov 2026): unframed and free, or framed for £30 (we cover the rest), so a sample costs us
// about the same either way (~£21.66). Previews created before SAMPLE_SWITCH_AT were offered a free framed print: honour it.
export const SAMPLE_SWITCH_AT = '2026-11-20T17:00:00Z';
export const SAMPLE_FRAME_UPGRADE_PENCE = 3000;
export const sampleIsUnframed = (order) => !!order && String(order.created_at || '') >= SAMPLE_SWITCH_AT;
