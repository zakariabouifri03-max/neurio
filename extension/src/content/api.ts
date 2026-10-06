import type { Analysis, ListingObservation } from "@etsy-signal/shared";
import { sendMessage, type HistoryResponse } from "../common/messages.js";

export async function ingestObservations(observations: ListingObservation[]): Promise<boolean> {
  if (observations.length === 0) return true;
  const res = await sendMessage({ type: "ingest", observations });
  return res.ok;
}

export async function fetchAnalysis(listingId: string): Promise<Analysis | null> {
  const res = await sendMessage({ type: "analysis", listingId });
  if (!res.ok) return null;
  return res.data as Analysis;
}

export async function fetchHistory(listingId: string): Promise<HistoryResponse | null> {
  const res = await sendMessage({ type: "history", listingId });
  if (!res.ok) return null;
  return res.data as HistoryResponse;
}
