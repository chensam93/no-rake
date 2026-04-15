export function progressRoundWhenNoPending(room, helpers) {
  const { resolveShowdown, advanceStreet, endRound } = helpers;
  const streetEvents = [];

  while (room.hand.pendingSeatNumbers.size === 0 && room.hand.inProgress) {
    if (room.hand.street === "river") {
      return { ended: true, endResult: resolveShowdown(room), streetEvents };
    }

    const transition = advanceStreet(room);
    if (!transition) {
      return {
        ended: true,
        endResult: endRound(room, "street_advance_failed"),
        streetEvents,
      };
    }
    streetEvents.push(transition);
  }

  return { ended: false, streetEvents };
}
