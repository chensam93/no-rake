import {
  buildPotsFromCommitments as buildPotsFromCommitmentsFromModule,
  resolvePots as resolvePotsFromModule,
} from "../engine/potResolution.js";

export function createShowdownService(context) {
  function applyPotPayout(room, winnerSeatNumbers) {
    if (!Array.isArray(winnerSeatNumbers) || winnerSeatNumbers.length === 0) {
      return [];
    }

    const uniqueWinners = [...new Set(winnerSeatNumbers)].sort((left, right) => left - right);
    if (room.hand.pot <= 0) {
      return uniqueWinners.map((seatNumber) => ({ seatNumber, amount: 0 }));
    }

    const splitAmount = Math.floor(room.hand.pot / uniqueWinners.length);
    const remainder = room.hand.pot % uniqueWinners.length;
    const payouts = [];

    for (let index = 0; index < uniqueWinners.length; index += 1) {
      const seatNumber = uniqueWinners[index];
      const amount = splitAmount + (index < remainder ? 1 : 0);
      const player = context.getPlayerBySeatNumber(room, seatNumber);
      if (player) {
        player.stack += amount;
      }
      payouts.push({ seatNumber, amount });
    }

    room.hand.pot = 0;
    return payouts;
  }

  function buildPotsFromCommitments(room) {
    const contributors = context
      .getSeatedPlayers(room)
      .filter((player) => (player.committedThisHand ?? 0) > 0)
      .map((player) => ({
        seatNumber: player.seatNumber,
        committed: player.committedThisHand ?? 0,
        folded: room.hand.foldedSeatNumbers.has(player.seatNumber),
      }));

    return buildPotsFromCommitmentsFromModule(contributors);
  }

  function distributePots(room, pots, resultsBySeat) {
    const { payouts, potBreakdown, totalPaid } = resolvePotsFromModule(
      pots,
      resultsBySeat,
      context.compareHandRanks,
    );

    for (const payout of payouts) {
      const player = context.getPlayerBySeatNumber(room, payout.seatNumber);
      if (player) {
        player.stack += payout.amount;
      }
    }

    room.hand.pot = Math.max(0, room.hand.pot - totalPaid);

    return { payouts, potBreakdown };
  }

  function endRound(room, reason, options = {}) {
    const normalizedOptions = options && typeof options === "object" ? options : {};
    const winnerSeatNumbers = normalizedOptions.winnerSeatNumbers ?? [];
    const winnerSeatNumber =
      normalizedOptions.winnerSeatNumber ??
      (winnerSeatNumbers.length > 0 ? winnerSeatNumbers[0] : null);

    room.hand.inProgress = false;
    room.hand.turnSeatNumber = null;
    room.hand.currentBet = 0;
    room.hand.minRaiseTo = null;
    room.hand.pendingSeatNumbers.clear();
    room.hand.raiseClosedSeatNumbers.clear();
    room.hand.lastEndReason = reason;
    room.hand.lastWinnerSeatNumber = winnerSeatNumber;
    room.hand.lastWinnerSeatNumbers = winnerSeatNumbers;
    room.hand.lastPayouts = normalizedOptions.payouts ?? [];
    room.hand.lastShowdown = normalizedOptions.showdown ?? null;
    room.hand.lastPotBreakdown = normalizedOptions.potBreakdown ?? [];
    context.maybeScheduleAutoStart(room, reason);

    return {
      reason,
      winnerSeatNumber,
      winnerSeatNumbers,
      payouts: room.hand.lastPayouts,
      showdown: room.hand.lastShowdown,
      potBreakdown: room.hand.lastPotBreakdown,
    };
  }

  function finishRoundWithWinners(room, reason, winnerSeatNumbers, showdown = null) {
    const payouts = applyPotPayout(room, winnerSeatNumbers);
    return endRound(room, reason, {
      winnerSeatNumbers,
      payouts,
      showdown,
      potBreakdown: [
        {
          amount: payouts.reduce((sum, payout) => sum + payout.amount, 0),
          winnerSeatNumbers: winnerSeatNumbers ?? [],
          payouts,
        },
      ],
    });
  }

  function resolveShowdown(room) {
    const activePlayers = context
      .getSeatedPlayers(room)
      .filter((player) => !room.hand.foldedSeatNumbers.has(player.seatNumber));
    if (activePlayers.length === 0) {
      return endRound(room, "showdown_no_players");
    }

    const results = [];
    for (const player of activePlayers) {
      const allCards = [...(player.holeCards ?? []), ...room.hand.board];
      const best = context.evaluateBestHand(allCards);
      if (!best) continue;
      results.push({
        seatNumber: player.seatNumber,
        playerName: player.playerName,
        bestCards: best.cards,
        rank: best.rank,
        rankLabel: context.formatRankLabel(best.rank),
      });
    }

    if (results.length === 0) {
      return endRound(room, "showdown_invalid_cards");
    }

    const resultsBySeat = new Map(results.map((result) => [result.seatNumber, result]));

    let bestResult = results[0];
    for (const result of results.slice(1)) {
      if (context.compareHandRanks(result.rank, bestResult.rank) > 0) {
        bestResult = result;
      }
    }

    const winners = results
      .filter((result) => context.compareHandRanks(result.rank, bestResult.rank) === 0)
      .map((result) => result.seatNumber)
      .sort((left, right) => left - right);

    const showdown = {
      winningHandLabel: bestResult.rankLabel,
      winningCards: bestResult.bestCards,
      boardCards: [...room.hand.board],
      players: results.map((result) => ({
        seatNumber: result.seatNumber,
        playerName: result.playerName,
        bestCards: result.bestCards,
        rankLabel: result.rankLabel,
      })),
    };
    const pots = buildPotsFromCommitments(room);
    if (pots.length === 0) {
      return finishRoundWithWinners(room, "showdown", winners, showdown);
    }
    const potResolution = distributePots(room, pots, resultsBySeat);
    return endRound(room, "showdown", {
      winnerSeatNumbers: winners,
      payouts: potResolution.payouts,
      potBreakdown: potResolution.potBreakdown,
      showdown,
    });
  }

  return {
    endRound,
    finishRoundWithWinners,
    resolveShowdown,
  };
}
