import { chooseBaselineBotAction, getSupportedBotProfiles, normalizeBotProfileName } from "../bot/strategy.js";
import { createSeededRng, nextSeed } from "../bot/rng.js";

const DEFAULT_BOT_DELAY_MS = 320;
const DEFAULT_BOT_SEED = 1337;

function ensureBotState(room) {
  if (!room.serverBot) {
    room.serverBot = {
      seatNumber: null,
      profile: "tag",
      seed: DEFAULT_BOT_SEED,
      actingDelayMs: DEFAULT_BOT_DELAY_MS,
      timer: null,
      botHandle: null,
    };
  }
  return room.serverBot;
}

function clearBotTimer(room) {
  const bot = ensureBotState(room);
  if (bot.timer) {
    clearTimeout(bot.timer);
    bot.timer = null;
  }
}

function getBotPlayer(room) {
  const bot = ensureBotState(room);
  if (bot.seatNumber === null || !bot.botHandle) return null;
  return room.playersBySocket.get(bot.botHandle) ?? null;
}

function isBotTurn(room) {
  const bot = ensureBotState(room);
  if (!room.hand.inProgress) return false;
  if (bot.seatNumber === null) return false;
  if (room.hand.turnSeatNumber !== bot.seatNumber) return false;
  return room.hand.pendingSeatNumbers.has(bot.seatNumber);
}

function deriveActiveSeatNumbers(room) {
  const activeSeats = [];
  for (const player of room.playersBySocket.values()) {
    if (!Number.isInteger(player?.seatNumber)) continue;
    if (Array.isArray(player.holeCards) && player.holeCards.length > 0) {
      activeSeats.push(player.seatNumber);
    }
  }
  return activeSeats.sort((left, right) => left - right);
}

function deriveLastAggressorSeatNumber(room) {
  const actionLog = Array.isArray(room.hand.actionLog) ? room.hand.actionLog : [];
  for (let index = actionLog.length - 1; index >= 0; index -= 1) {
    const action = actionLog[index];
    if (action?.street !== room.hand.street) continue;
    if (action?.actionType !== "raise_to" && action?.actionType !== "bet") continue;
    if (Number.isInteger(action?.seatNumber)) {
      return action.seatNumber;
    }
  }
  return null;
}

function deriveBotState(room, helpers) {
  const bot = ensureBotState(room);
  if (!isBotTurn(room)) return null;
  const player = getBotPlayer(room);
  if (!player) return null;

  const currentBet = Number(room.hand.currentBet ?? 0);
  const committedThisStreet = Number(player.committedThisStreet ?? 0);
  const stack = Number(player.stack ?? 0);
  const allCards = [...(player.holeCards ?? []), ...(room.hand.board ?? [])];
  const best = allCards.length >= 5 ? helpers.evaluateBestHand(allCards) : null;

  return {
    inProgress: room.hand.inProgress,
    isBotTurn: true,
    seatNumber: bot.seatNumber,
    profileName: bot.profile,
    street: room.hand.street,
    pot: Number(room.hand.pot ?? 0),
    currentBet,
    committedThisStreet,
    stack,
    minRaiseTo: room.hand.minRaiseTo,
    bigBlind: Number(room.table?.bigBlind ?? room.hand?.bigBlind ?? 20),
    dealerSeatNumber: Number.isInteger(room.hand.dealerSeatNumber) ? room.hand.dealerSeatNumber : null,
    activeSeatNumbers: deriveActiveSeatNumbers(room),
    lastAggressorSeatNumber: deriveLastAggressorSeatNumber(room),
    raiseClosedSeatNumbers: room.hand.raiseClosedSeatNumbers,
    holeCards: player.holeCards ?? [],
    boardCards: room.hand.board ?? [],
    bestRankCategory: best?.rank?.category ?? 0,
  };
}

export function createServerBotService(context) {
  function getBotStateSnapshot(room) {
    const bot = ensureBotState(room);
    return {
      seatNumber: bot.seatNumber,
      profile: bot.profile,
      seed: bot.seed,
      actingDelayMs: bot.actingDelayMs,
      profiles: getSupportedBotProfiles(),
      isActive: bot.seatNumber !== null,
    };
  }

  function setBotSeat(room, seatNumber, profileName) {
    const bot = ensureBotState(room);
    clearBotTimer(room);

    const normalizedSeat = Number(seatNumber);
    if (!Number.isInteger(normalizedSeat) || normalizedSeat < 1 || normalizedSeat > context.MAX_SEATS) {
      return { ok: false, message: `seatNumber must be an integer between 1 and ${context.MAX_SEATS}` };
    }
    const existingSeatPlayer = context.getPlayerBySeatNumber(room, normalizedSeat);
    if (existingSeatPlayer && !existingSeatPlayer.isServerBot) {
      return { ok: false, message: "seat already occupied by a human player" };
    }

    if (bot.seatNumber !== null && bot.botHandle && bot.seatNumber !== normalizedSeat) {
      room.playersBySocket.delete(bot.botHandle);
      bot.botHandle = null;
      bot.seatNumber = null;
    }

    if (!bot.botHandle) {
      bot.botHandle = {
        readyState: 0,
        send() {},
      };
    }
    bot.seatNumber = normalizedSeat;
    bot.profile = normalizeBotProfileName(profileName ?? bot.profile);

    const existingBotPlayer = room.playersBySocket.get(bot.botHandle);
    if (existingBotPlayer) {
      existingBotPlayer.seatNumber = normalizedSeat;
      existingBotPlayer.isServerBot = true;
      existingBotPlayer.botProfile = bot.profile;
    } else {
      room.playersBySocket.set(bot.botHandle, {
        playerName: `bot-s${normalizedSeat}`,
        seatNumber: normalizedSeat,
        stack: context.STARTING_STACK,
        committedThisStreet: 0,
        committedThisHand: 0,
        holeCards: [],
        isServerBot: true,
        botProfile: bot.profile,
      });
    }
    return { ok: true, seatNumber: bot.seatNumber, profile: bot.profile };
  }

  function clearBotSeat(room) {
    const bot = ensureBotState(room);
    clearBotTimer(room);
    if (bot.botHandle) {
      room.playersBySocket.delete(bot.botHandle);
    }
    bot.seatNumber = null;
    bot.botHandle = null;
    context.maybeResolveHandAfterMembershipChange(room);
    return { ok: true };
  }

  function setBotProfile(room, profileName) {
    const bot = ensureBotState(room);
    const normalized = normalizeBotProfileName(profileName);
    bot.profile = normalized;
    if (bot.botHandle) {
      const player = room.playersBySocket.get(bot.botHandle);
      if (player) player.botProfile = normalized;
    }
    return { ok: true, profile: normalized };
  }

  function setBotSeed(room, seed) {
    const bot = ensureBotState(room);
    const parsedSeed = Number(seed);
    if (!Number.isInteger(parsedSeed)) {
      return { ok: false, message: "seed must be an integer" };
    }
    bot.seed = parsedSeed >>> 0;
    if (bot.seed === 0) bot.seed = DEFAULT_BOT_SEED;
    return { ok: true, seed: bot.seed };
  }

  function setBotDelay(room, delayMs) {
    const bot = ensureBotState(room);
    const parsed = Number(delayMs);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3000) {
      return { ok: false, message: "delayMs must be an integer between 0 and 3000" };
    }
    bot.actingDelayMs = parsed;
    return { ok: true, delayMs: bot.actingDelayMs };
  }

  function executeBotAction(room) {
    const bot = ensureBotState(room);
    if (!isBotTurn(room) || !bot.botHandle || bot.seatNumber === null) return false;

    const beforeActionLogLength = room.hand.actionLog.length;
    const beforeTurnSeatNumber = room.hand.turnSeatNumber;
    const botState = deriveBotState(room, { evaluateBestHand: context.evaluateBestHand });
    if (!botState) return false;

    const rng = createSeededRng(bot.seed);
    bot.seed = nextSeed(bot.seed);
    const decision = chooseBaselineBotAction(botState, rng);
    if (!decision) return false;

    const payload = {
      type: "player_action",
      actionType: decision.actionType,
    };
    if (Number.isInteger(decision.amount)) {
      payload.amount = decision.amount;
    }

    context.runInternalPlayerAction(
      bot.botHandle,
      { roomId: room.id, playerName: `bot-s${bot.seatNumber}` },
      payload,
    );

    // Safety fallback: if no state transition happened, fold to avoid stuck timers.
    if (
      room.hand.inProgress &&
      room.hand.turnSeatNumber === beforeTurnSeatNumber &&
      room.hand.actionLog.length === beforeActionLogLength &&
      room.hand.pendingSeatNumbers.has(bot.seatNumber)
    ) {
      context.runInternalPlayerAction(
        bot.botHandle,
        { roomId: room.id, playerName: `bot-s${bot.seatNumber}` },
        { type: "player_action", actionType: "fold" },
      );
    }
    return true;
  }

  function maybeScheduleBotAction(room) {
    const bot = ensureBotState(room);
    clearBotTimer(room);
    if (!isBotTurn(room)) return false;
    if (room.table.manualStepMode) return false;
    if (bot.seatNumber === null) return false;

    bot.timer = setTimeout(() => {
      bot.timer = null;
      if (!context.rooms.has(room.id)) return;
      executeBotAction(room);
    }, bot.actingDelayMs);
    return true;
  }

  function runBotStep(room) {
    clearBotTimer(room);
    if (!isBotTurn(room)) {
      return { acted: false, reason: "no_bot_turn" };
    }
    const acted = executeBotAction(room);
    return { acted, reason: acted ? "bot_acted" : "bot_failed" };
  }

  return {
    getBotStateSnapshot,
    setBotSeat,
    clearBotSeat,
    setBotProfile,
    setBotSeed,
    setBotDelay,
    maybeScheduleBotAction,
    runBotStep,
    clearBotTimer,
  };
}
