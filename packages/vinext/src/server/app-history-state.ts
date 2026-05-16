const VINEXT_PREVIOUS_NEXT_URL_HISTORY_STATE_KEY = "__vinext_previousNextUrl";

type HistoryStateRecord = {
  [key: string]: unknown;
};

function cloneHistoryState(state: unknown): HistoryStateRecord {
  if (!state || typeof state !== "object") {
    return {};
  }

  const nextState: HistoryStateRecord = {};
  for (const [key, value] of Object.entries(state)) {
    nextState[key] = value;
  }
  return nextState;
}

export function createHistoryStateWithPreviousNextUrl(
  state: unknown,
  previousNextUrl: string | null,
): HistoryStateRecord | null {
  const nextState = cloneHistoryState(state);

  if (previousNextUrl === null) {
    delete nextState[VINEXT_PREVIOUS_NEXT_URL_HISTORY_STATE_KEY];
  } else {
    nextState[VINEXT_PREVIOUS_NEXT_URL_HISTORY_STATE_KEY] = previousNextUrl;
  }

  return Object.keys(nextState).length > 0 ? nextState : null;
}

export function createExternalHistoryStatePreservingMetadata(
  callerState: unknown,
  currentHistoryState: unknown,
): unknown {
  const previousNextUrl = readHistoryStatePreviousNextUrl(currentHistoryState);
  if (previousNextUrl === null) {
    return callerState;
  }

  return createHistoryStateWithPreviousNextUrl(callerState, previousNextUrl);
}

export function readHistoryStatePreviousNextUrl(state: unknown): string | null {
  const value = cloneHistoryState(state)[VINEXT_PREVIOUS_NEXT_URL_HISTORY_STATE_KEY];
  return typeof value === "string" ? value : null;
}
