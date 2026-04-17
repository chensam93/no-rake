import { progressRoundWhenNoPending as progressRoundWhenNoPendingFromModule } from "../engine/roundProgression.js";

const STREETS = ["preflop", "flop", "turn", "river"];

function buildDeck() {
  const suits = ["c", "d", "h", "s"];
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

function shuffle(array) {
  const copy = [...array];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = temp;
  }
  return copy;
}

function drawCards(room, count) {
  if (!room.hand.deck || room.hand.deck.length < count) {
    return [];
  }

  return room.hand.deck.splice(0, count);
}

export function createRoundLifecycle(context) {
  function postBlind(room, seatNumber, amount, blindType) {
    if (seatNumber === null) return;

    const player = context.getPlayerBySeatNumber(room, seatNumber);
    if (!player) return;

    const blindAmount = Math.min(amount, player.stack);

    player.stack -= blindAmount;
    player.committedThisStreet += blindAmount;
    player.committedThisHand += blindAmount;

    room.hand.pot += blindAmount;
    room.hand.currentBet = Math.max(room.hand.currentBet, player.committedThisStreet);

    room.hand.actionLog.push({
      seatNumber,
      playerName: player.playerName,
      actionType: blindType,
      amountCommitted: blindAmount,
      toCallBeforeAction: 0,
      street: room.hand.street,
    });
  }

  function startRound(room) {
    const seatedPlayers = context.getSeatedPlayers(room);
    if (seatedPlayers.length < 2) {
      return { ok: false, message: "need at least 2 seated players" };
    }

    context.clearAutoStartTimer(room);

    const seatedSeatNumbers = seatedPlayers.map((player) => player.seatNumber);

    let dealerSeatNumber;
    if (
      room.table.dealerSeatNumber === null ||
      !seatedSeatNumbers.includes(room.table.dealerSeatNumber)
    ) {
      dealerSeatNumber = seatedSeatNumbers[0];
    } else {
      dealerSeatNumber = context.getNextSeatInList(seatedSeatNumbers, room.table.dealerSeatNumber);
    }

    room.table.dealerSeatNumber = dealerSeatNumber;

    const smallBlindSeatNumber = context.getNextSeatInList(seatedSeatNumbers, dealerSeatNumber);
    const bigBlindSeatNumber = context.getNextSeatInList(seatedSeatNumbers, smallBlindSeatNumber);

    room.hand.inProgress = true;
    room.hand.street = "preflop";
    room.hand.board = [];
    room.hand.deck = shuffle(buildDeck());
    room.hand.pot = 0;
    room.hand.foldedSeatNumbers.clear();
    room.hand.pendingSeatNumbers = new Set(seatedSeatNumbers);
    room.hand.raiseClosedSeatNumbers.clear();
    room.hand.actionLog = [];
    room.hand.turnSeatNumber = null;
    room.hand.currentBet = 0;
    room.hand.minRaiseTo = null;
    room.hand.lastEndReason = null;
    room.hand.lastWinnerSeatNumber = null;
    room.hand.lastWinnerSeatNumbers = [];
    room.hand.lastPayouts = [];
    room.hand.lastShowdown = null;
    room.hand.lastPotBreakdown = [];
    room.hand.dealerSeatNumber = dealerSeatNumber;
    room.hand.smallBlindSeatNumber = smallBlindSeatNumber;
    room.hand.bigBlindSeatNumber = bigBlindSeatNumber;

    for (const player of room.playersBySocket.values()) {
      player.committedThisStreet = 0;
      player.committedThisHand = 0;
      player.holeCards = [];
    }

    for (const player of context.getSeatedPlayers(room)) {
      player.holeCards = drawCards(room, 2);
    }

    postBlind(room, smallBlindSeatNumber, room.table.smallBlind, "post_small_blind");
    postBlind(room, bigBlindSeatNumber, room.table.bigBlind, "post_big_blind");

    room.hand.minRaiseTo = room.hand.currentBet + room.table.bigBlind;
    room.hand.pendingSeatNumbers = new Set(context.getActionEligibleSeatNumbers(room));
    room.hand.turnSeatNumber = context.getNextPendingTurnSeatNumber(room, bigBlindSeatNumber);
    if (room.hand.turnSeatNumber === null) {
      room.hand.turnSeatNumber = context.getNextActiveSeatAfter(room, bigBlindSeatNumber);
    }

    return {
      ok: true,
      turnSeatNumber: room.hand.turnSeatNumber,
      street: room.hand.street,
    };
  }

  function advanceStreet(room) {
    const currentStreetIndex = STREETS.indexOf(room.hand.street);
    if (currentStreetIndex === -1 || currentStreetIndex >= STREETS.length - 1) {
      return null;
    }

    const nextStreet = STREETS[currentStreetIndex + 1];

    let drawnCards = [];
    if (nextStreet === "flop") {
      drawnCards = drawCards(room, 3);
    } else {
      drawnCards = drawCards(room, 1);
    }

    room.hand.street = nextStreet;
    room.hand.board.push(...drawnCards);
    room.hand.currentBet = 0;
    room.hand.minRaiseTo = null;

    const activeSeatNumbers = context.getActiveSeatNumbers(room);
    room.hand.pendingSeatNumbers = new Set(
      activeSeatNumbers.filter((seatNumber) => {
        const player = context.getPlayerBySeatNumber(room, seatNumber);
        return Number(player?.stack ?? 0) > 0;
      }),
    );
    room.hand.raiseClosedSeatNumbers.clear();

    for (const player of room.playersBySocket.values()) {
      player.committedThisStreet = 0;
    }

    room.hand.turnSeatNumber = context.getNextPendingTurnSeatNumber(
      room,
      room.hand.dealerSeatNumber,
    );

    return {
      street: nextStreet,
      boardCards: drawnCards,
      turnSeatNumber: room.hand.turnSeatNumber,
    };
  }

  function maybeEndRoundOnFold(room) {
    const activeSeatNumbers = context.getActiveSeatNumbers(room);
    if (activeSeatNumbers.length > 1) return null;
    if (activeSeatNumbers.length === 1) {
      return context.finishRoundWithWinners(room, "fold_winner", [activeSeatNumbers[0]]);
    }
    return context.endRound(room, "all_folded");
  }

  function maybeResolveHandAfterMembershipChange(room) {
    if (!room.hand.inProgress) return;

    const activeSeatNumbers = context.getActiveSeatNumbers(room);
    for (const pendingSeatNumber of [...room.hand.pendingSeatNumbers]) {
      const player = context.getPlayerBySeatNumber(room, pendingSeatNumber);
      if (!activeSeatNumbers.includes(pendingSeatNumber) || Number(player?.stack ?? 0) <= 0) {
        room.hand.pendingSeatNumbers.delete(pendingSeatNumber);
      }
    }

    if (activeSeatNumbers.length <= 1) {
      if (activeSeatNumbers.length === 1) {
        context.finishRoundWithWinners(room, "fold_winner", [activeSeatNumbers[0]]);
      } else {
        context.endRound(room, "all_left_table");
      }
      return;
    }

    if (room.hand.pendingSeatNumbers.size === 0) {
      room.hand.turnSeatNumber = null;
      return;
    }

    if (
      room.hand.turnSeatNumber === null ||
      !activeSeatNumbers.includes(room.hand.turnSeatNumber) ||
      !room.hand.pendingSeatNumbers.has(room.hand.turnSeatNumber)
    ) {
      room.hand.turnSeatNumber = context.getNextPendingTurnSeatNumber(
        room,
        room.hand.turnSeatNumber ?? activeSeatNumbers[0],
      );
    }
  }

  function progressRoundWhenNoPending(room) {
    return progressRoundWhenNoPendingFromModule(room, {
      resolveShowdown: context.resolveShowdown,
      advanceStreet,
      endRound: context.endRound,
    });
  }

  function getPlayerToCallAmount(room, player) {
    return Math.max(0, room.hand.currentBet - player.committedThisStreet);
  }

  return {
    startRound,
    advanceStreet,
    maybeEndRoundOnFold,
    maybeResolveHandAfterMembershipChange,
    progressRoundWhenNoPending,
    getPlayerToCallAmount,
  };
}
