import WhiteMarket from './whitemarket_api.ts';
const configData = await Deno.readTextFile('./config.json');
const config = JSON.parse(configData);
import TelegramBot from 'node-telegram-bot-api';
import { calculateProfit, checkCacheDate, updateBanList, checkCurrentList, removeFromBanList } from './calculateProfit.ts';

const allowedUserIds: number[] = [6571509230];

const bot = new TelegramBot(config.TelegramBot, {
    polling: {
        interval: 1000,
        autoStart: true,
        params: { offset: -1 }
    }
});

const whitemarketInstances: Record<number, WhiteMarket> = {};

config.whitemarket.forEach((market: any, index: number) => {
    whitemarketInstances[index + 1] = new WhiteMarket(market, bot, allowedUserIds[0]);
});


initBot();
function initBot() {
    const checkUserIdMiddleware = (msg: TelegramBot.Message, next: () => void) => {
        const userId = msg.from?.id;
        if (userId && allowedUserIds.includes(userId)) {
            next();
        } else {
            console.log(msg);
            bot.sendMessage(msg.chat.id, 'You are not authorized to use this bot.');
        }
    };

    const handleCommand = (regex: RegExp, callback: (msg: TelegramBot.Message, match: RegExpExecArray | null) => void) => {
        bot.onText(regex, (msg, match) => {
            checkUserIdMiddleware(msg, () => {
                callback(msg, match);
            });
        });
    };

    function getWhiteMarketInstance(instanceNumber: number): WhiteMarket | null {
        return whitemarketInstances[instanceNumber] || null;
    }

    handleCommand(/\/WM_status (\d+)/, (msg, match) => {
        const instanceNumber = parseInt(match![1]);
        const instance = getWhiteMarketInstance(instanceNumber);
        instance ? instance.checkStatus() : console.log(`Instance ${instanceNumber} does not exist`);
    });

    handleCommand(/\/WM_start (\d+)/, (msg, match) => {
        const instanceNumber = parseInt(match![1]);
        const instance = getWhiteMarketInstance(instanceNumber);
        instance ? instance.runBot() : console.log(`Instance ${instanceNumber} does not exist`);
    });

    handleCommand(/\/WM_stop (\d+)/, (msg, match) => {
        const instanceNumber = parseInt(match![1]);
        const instance = getWhiteMarketInstance(instanceNumber);
        instance ? instance.stopBot() : console.log(`Instance ${instanceNumber} does not exist`);
    });

    handleCommand(/\/WM_limit_min (\d+) (\d+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const instanceNumber = parseInt(match![1]);
        const newLimit = parseInt(match![2]);
        const instance = getWhiteMarketInstance(instanceNumber);
        if (instance && Number.isInteger(newLimit)) {
            instance.changeLimitMin(newLimit);
        } else {
            bot.sendMessage(chatId, `Invalid input or instance does not exist.`);
        }
    });

    handleCommand(/\/WM_limit_max (\d+) (\d+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const instanceNumber = parseInt(match![1]);
        const newLimit = parseInt(match![2]);
        const instance = getWhiteMarketInstance(instanceNumber);
        if (instance && Number.isInteger(newLimit)) {
            instance.changeLimitMax(newLimit);
        } else {
            bot.sendMessage(chatId, `Invalid input or instance does not exist.`);
        }
    });

    handleCommand(/\/WM_profit (\d+) ([0-9]*\.?[0-9]+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const instanceNumber = parseInt(match![1]);
        const newLimit = parseFloat(match![2]);
        const instance = getWhiteMarketInstance(instanceNumber);
        if (instance && newLimit > 1) {
            instance.changeProfit(newLimit);
        } else {
            bot.sendMessage(chatId, `Invalid profit margin or instance does not exist.`);
        }
    });

    handleCommand(/\/WM_liquid (\d+) (\d+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const instanceNumber = parseInt(match![1]);
        const newLimit = parseInt(match![2]);
        const instance = getWhiteMarketInstance(instanceNumber);
        if (instance && newLimit > 10 && newLimit < 100) {
            instance.changeLiquidity(newLimit);
        } else {
            bot.sendMessage(chatId, `Invalid liquidity limit or instance does not exist.`);
        }
    });

    handleCommand(/\/WM_quantity (\d+) (\d+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const instanceNumber = parseInt(match![1]);
        const newLimit = parseInt(match![2]);
        const instance = getWhiteMarketInstance(instanceNumber);
        if (instance && newLimit > 1) {
            instance.changeQuantity(newLimit);
        } else {
            bot.sendMessage(chatId, `Invalid quantity or instance does not exist.`);
        }
    });

    handleCommand(/\/WM_changeKey (\d+) (.+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const instanceNumber = parseInt(match![1]);
        const newKey = match![2];
        const instance = getWhiteMarketInstance(instanceNumber);
        if (instance) {
            instance.changeApikey(newKey);
        } else {
            bot.sendMessage(chatId, `Instance ${instanceNumber} does not exist.`);
        }
    });

    handleCommand(/\/ban_list/, (msg) => {
        const chatId = msg.chat.id;
        const result = checkCurrentList();
        bot.sendMessage(chatId, result);
    });

    handleCommand(/\/add_ban (.+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const banItem = match![1].trim();
        updateBanList(banItem);
        bot.sendMessage(chatId, `${banItem} has been added to the ban list!`);
    });

    handleCommand(/\/remove_ban (.+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const banItem = match![1].trim();
        removeFromBanList(banItem);
        bot.sendMessage(chatId, `${banItem} has been removed from the ban list!`);
    });

    bot.on('polling_error', (error) => {
        // console.error('Polling Error:', error);
    });
}