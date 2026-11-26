type Session = {
  state: string;
  desiredState: string;
  expectedWaId: string;
  connectedWaId: string | null;
  lastSeenAt: Date | null;
};
export function evolutionSessionReady(session: Session | null | undefined, now = Date.now()) {
  return Boolean(
    session &&
    session.state === 'CONNECTED' &&
    session.desiredState === 'CONNECTED' &&
    session.connectedWaId === session.expectedWaId &&
    session.lastSeenAt &&
    session.lastSeenAt.getTime() > now - 45000,
  );
}
