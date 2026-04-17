import {
  buildPendingSeatsAfterAggressiveAction,
  buildRaiseClosedSeatNumbers,
} from "../../engine/actionState.js";
import { validateBetAmount, validateRaiseTarget } from "../../engine/actionValidation.js";
import { doesRaiseReopenAction, computeNextMinRaiseTo } from "../../engine/bettingRules.js";

const PLAYER_ACTIONS = new Set(["fold", "check", "call", "bet", "raise_to"]);

export function createPlayerActionHandlers(context) {
  function handlePlayerAction(socket, session, parsed) {
    if (!session.roomId || !session.playerName) {
      context.sendJson(socket, { type: "error", message: "join_room before player_action" });
      return;
    }

    const actionType = parsed.actionType;
    if (!PLAYER_ACTIONS.has(actionType)) {
      context.sendJson(socket, {
        type: "error",
        message: "actionType must be fold, check, call, bet, or raise_to",
      });
      return;
    }

    const room = context.getRoom(session.roomId);
    if (!room) {
      context.sendJson(socket, { type: "error", message: "room not found" });
      return;
    }

    if (!room.hand.inProgress) {
      context.sendJson(socket, { type: "error", message: "no active round" });
      return;
    }

    const currentPlayer = room.playersBySocket.get(socket);
    if (!currentPlayer || currentPlayer.seatNumber === null) {
      context.sendJson(socket, { type: "error", message: "you are not seated" });
      return;
    }

    if (currentPlayer.seatNumber !== room.hand.turnSeatNumber) {
      context.sendJson(socket, {
        type: "error",
        message: `not your turn; turnSeatNumber is ${room.hand.turnSeatNumber}`,
      });
      return;
    }

    const toCall = context.getPlayerToCallAmount(room, currentPlayer);
    const pendingSeatNumbersBeforeAction = new Set(room.hand.pendingSeatNumbers);
    let amountCommitted = 0;
    let note = null;

    if (actionType === "check") {
      if (toCall > 0) {
        context.sendJson(socket, {
          type: "error",
          message: `cannot check; call amount is ${toCall}`,
        });
        return;
      }
      room.hand.pendingSeatNumbers.delete(currentPlayer.seatNumber);
    } else if (actionType === "call") {
      if (toCall <= 0) {
        context.sendJson(socket, {
          type: "error",
          message: "nothing to call; use check",
        });
        return;
      }

      const callAmount = Math.min(toCall, currentPlayer.stack);
      if (callAmount <= 0) {
        context.sendJson(socket, { type: "error", message: "insufficient stack for call" });
        return;
      }

      currentPlayer.stack -= callAmount;
      currentPlayer.committedThisStreet += callAmount;
      currentPlayer.committedThisHand += callAmount;
      room.hand.pot += callAmount;
      amountCommitted = callAmount;
      if (callAmount < toCall) {
        note = "all_in_call";
      }
      room.hand.pendingSeatNumbers.delete(currentPlayer.seatNumber);
    } else if (actionType === "bet") {
      if (room.hand.currentBet > 0) {
        context.sendJson(socket, {
          type: "error",
          message: "bet only allowed when currentBet is 0; use raise_to",
        });
        return;
      }

      const amount = Number(parsed.amount);
      const betValidationError = validateBetAmount(amount, currentPlayer.stack);
      if (betValidationError) {
        context.sendJson(socket, { type: "error", message: betValidationError });
        return;
      }

      currentPlayer.stack -= amount;
      currentPlayer.committedThisStreet += amount;
      currentPlayer.committedThisHand += amount;
      room.hand.pot += amount;

      room.hand.currentBet = currentPlayer.committedThisStreet;
      room.hand.minRaiseTo = room.hand.currentBet * 2;
      room.hand.raiseClosedSeatNumbers.clear();
      amountCommitted = amount;
      note = `currentBet=${room.hand.currentBet}`;

      const activeSeatNumbers = context.getActionEligibleSeatNumbers(room);
      room.hand.pendingSeatNumbers = buildPendingSeatsAfterAggressiveAction(
        activeSeatNumbers,
        currentPlayer.seatNumber,
      );
    } else if (actionType === "raise_to") {
      if (room.hand.raiseClosedSeatNumbers.has(currentPlayer.seatNumber)) {
        context.sendJson(socket, {
          type: "error",
          message: "raising is not reopened for your seat; call or fold",
        });
        return;
      }

      if (room.hand.currentBet <= 0) {
        context.sendJson(socket, {
          type: "error",
          message: "raise_to requires an existing currentBet; use bet first",
        });
        return;
      }

      const targetAmount = Number(parsed.amount);
      const raiseValidationError = validateRaiseTarget({
        targetAmount,
        currentBet: room.hand.currentBet,
        currentCommittedThisStreet: currentPlayer.committedThisStreet,
        currentStack: currentPlayer.stack,
        minRaiseTo: room.hand.minRaiseTo,
      });
      if (raiseValidationError) {
        context.sendJson(socket, {
          type: "error",
          message: raiseValidationError,
        });
        return;
      }

      const amountToCommit = targetAmount - currentPlayer.committedThisStreet;
      const isAllInTarget = targetAmount === currentPlayer.committedThisStreet + currentPlayer.stack;
      const reopensAction = doesRaiseReopenAction(room.hand.minRaiseTo, targetAmount);

      const previousCurrentBet = room.hand.currentBet;
      const previousMinRaiseTo = room.hand.minRaiseTo;

      currentPlayer.stack -= amountToCommit;
      currentPlayer.committedThisStreet += amountToCommit;
      currentPlayer.committedThisHand += amountToCommit;
      room.hand.pot += amountToCommit;

      room.hand.currentBet = currentPlayer.committedThisStreet;

      const raiseIncrement = room.hand.currentBet - previousCurrentBet;
      if (raiseIncrement > 0) {
        room.hand.minRaiseTo = computeNextMinRaiseTo({
          previousCurrentBet,
          previousMinRaiseTo,
          nextCurrentBet: room.hand.currentBet,
          raiseIncrement,
          reopensAction,
        });
      }
      amountCommitted = amountToCommit;
      note = isAllInTarget
        ? reopensAction
          ? "all_in_raise"
          : "all_in_raise_no_reopen"
        : `currentBet=${room.hand.currentBet}`;

      const activeSeatNumbers = context.getActionEligibleSeatNumbers(room);
      room.hand.pendingSeatNumbers = buildPendingSeatsAfterAggressiveAction(
        activeSeatNumbers,
        currentPlayer.seatNumber,
      );

      if (reopensAction) {
        room.hand.raiseClosedSeatNumbers.clear();
      } else {
        room.hand.raiseClosedSeatNumbers = buildRaiseClosedSeatNumbers(
          activeSeatNumbers,
          currentPlayer.seatNumber,
          pendingSeatNumbersBeforeAction,
        );
      }
    } else if (actionType === "fold") {
      room.hand.foldedSeatNumbers.add(currentPlayer.seatNumber);
      room.hand.pendingSeatNumbers.delete(currentPlayer.seatNumber);
    }

    room.hand.actionLog.push({
      seatNumber: currentPlayer.seatNumber,
      playerName: currentPlayer.playerName,
      actionType,
      amountCommitted,
      toCallBeforeAction: toCall,
      street: room.hand.street,
    });

    const foldEndResult = context.maybeEndRoundOnFold(room);
    if (foldEndResult !== null) {
      context.sendJson(socket, {
        type: "round_ended",
        roomId: session.roomId,
        winnerSeatNumber: foldEndResult.winnerSeatNumber,
        winnerSeatNumbers: foldEndResult.winnerSeatNumbers,
        payouts: foldEndResult.payouts,
        potBreakdown: foldEndResult.potBreakdown,
        showdown: foldEndResult.showdown,
        reason: foldEndResult.reason,
      });

      context.publishRoomState(session.roomId);
      context.maybeScheduleServerBotAction(room);
      return;
    }

    if (room.hand.pendingSeatNumbers.size === 0) {
      if (room.table.manualStepMode) {
        room.hand.turnSeatNumber = null;
        context.sendJson(socket, {
          type: "action_applied",
          roomId: session.roomId,
          actionType,
          amountCommitted,
          nextTurnSeatNumber: null,
          note: `${note || "ok"} manual_step_wait`,
        });
        context.publishRoomState(session.roomId);
        context.maybeScheduleServerBotAction(room);
        return;
      }

      const progression = context.progressRoundWhenNoPending(room);
      for (const transition of progression.streetEvents) {
        context.sendJson(socket, {
          type: "street_advanced",
          roomId: session.roomId,
          street: transition.street,
          boardCards: transition.boardCards,
          turnSeatNumber: transition.turnSeatNumber,
        });
      }

      if (progression.ended) {
        context.sendJson(socket, {
          type: "round_ended",
          roomId: session.roomId,
          winnerSeatNumber: progression.endResult.winnerSeatNumber,
          winnerSeatNumbers: progression.endResult.winnerSeatNumbers,
          payouts: progression.endResult.payouts,
          potBreakdown: progression.endResult.potBreakdown,
          showdown: progression.endResult.showdown,
          reason: progression.endResult.reason,
        });
        context.publishRoomState(session.roomId);
        context.maybeScheduleServerBotAction(room);
        return;
      }

      context.publishRoomState(session.roomId);
      context.maybeScheduleServerBotAction(room);
      return;
    }

    room.hand.turnSeatNumber = context.getNextPendingTurnSeatNumber(
      room,
      currentPlayer.seatNumber,
    );

    context.sendJson(socket, {
      type: "action_applied",
      roomId: session.roomId,
      actionType,
      amountCommitted,
      nextTurnSeatNumber: room.hand.turnSeatNumber,
      note,
    });

    context.publishRoomState(session.roomId);
    context.maybeScheduleServerBotAction(room);
  }

  return {
    handlePlayerAction,
  };
}
