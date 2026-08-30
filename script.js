require('dotenv').config();
const puppeteer = require('puppeteer');
const { createBot } = require('./bot');
const parser = require('./parser');
const storage = require('./storage');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

let activeBot = null;

function parseRelativeTime(timeStr) {
    if (!timeStr) return null;

    const now = new Date();
    const lower = timeStr.toLowerCase().trim();

    const todayMatch = lower.match(/сегодня[,]?\s*(\d{1,2}):(\d{2})/);
    if (todayMatch) {
        const d = new Date(now);
        d.setHours(parseInt(todayMatch[1], 10), parseInt(todayMatch[2], 10), 0, 0);
        return d;
    }

    const yesterdayMatch = lower.match(/вчера[,]?\s*(\d{1,2}):(\d{2})/);
    if (yesterdayMatch) {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        d.setHours(parseInt(yesterdayMatch[1], 10), parseInt(yesterdayMatch[2], 10), 0, 0);
        return d;
    }

    const daysMatch = lower.match(/(\d+)\s*дн/);
    if (daysMatch) {
        const d = new Date(now);
        d.setDate(d.getDate() - parseInt(daysMatch[1], 10));
        return d;
    }

    const hoursMatch = lower.match(/(\d+)\s*час/);
    if (hoursMatch) {
        const d = new Date(now);
        d.setHours(d.getHours() - parseInt(hoursMatch[1], 10));
        return d;
    }

    const minsMatch = lower.match(/(\d+)\s*мин/);
    if (minsMatch) {
        const d = new Date(now);
        d.setMinutes(d.getMinutes() - parseInt(minsMatch[1], 10));
        return d;
    }

    return null;
}

function isAdNewerThan(adTime, monitoringStartedAt) {
    if (!monitoringStartedAt) return true;

    const adDate = parseRelativeTime(adTime);
    if (!adDate) return true;

    return adDate.getTime() >= monitoringStartedAt;
}

function formatAdTime(timeStr) {
    if (!timeStr) return null;

    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const todayStr = `${day}.${month}.${year}`;

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yDay = String(yesterday.getDate()).padStart(2, '0');
    const yMonth = String(yesterday.getMonth() + 1).padStart(2, '0');
    const yYear = yesterday.getFullYear();
    const yesterdayStr = `${yDay}.${yMonth}.${yYear}`;

    if (timeStr.includes('Сегодня')) {
        return timeStr.replace('Сегодня', `Сегодня (${todayStr})`);
    }
    if (timeStr.includes('Вчера')) {
        return timeStr.replace('Вчера', `Вчера (${yesterdayStr})`);
    }

    return timeStr;
}

async function sendNotification(bot, chatId, message) {
    try {
        await bot.telegram.sendMessage(chatId, message);
    } catch (error) {
        console.error(`[Bot] Ошибка отправки пользователю ${chatId}: ${error.message}`);
    }
}

async function checkUser(bot, chatId, user) {
    if (!user.monitoring || !user.url) return;

    try {
        const ads = await parser.parseAds(user.url);
        const knownAds = storage.loadAds(chatId);
        const isFirstRun = Object.keys(knownAds).length === 0;

        if (isFirstRun) {
            for (const ad of ads) {
                knownAds[ad.id] = {
                    title: ad.title,
                    price: ad.price,
                    location: ad.location,
                    time: ad.time,
                    link: ad.link,
                    sent_at: Date.now(),
                };
            }
            storage.saveAds(chatId, knownAds);
            console.log(`[Parser] Пользователь ${chatId}: кэш инициализирован (${ads.length} объявлений), уведомления не отправляются`);
            return;
        }

        const newEntries = ads.filter(ad => {
            if (knownAds[ad.id]) return false;
            return isAdNewerThan(ad.time, user.monitoring_started_at);
        });

        if (newEntries.length > 0) {
            for (const ad of newEntries) {
                const lines = [];
                lines.push(`📱 Новое объявление`);
                lines.push(``);
                lines.push(`Название публикации: ${ad.title}`);
                lines.push(`Цена: ${ad.price}`);
                if (ad.location) lines.push(`Регион: ${ad.location}`);
                if (ad.time) lines.push(`Время: ${formatAdTime(ad.time)}`);
                lines.push(``);
                lines.push(`Ссылка: ${ad.link}`);
                lines.push(``);
                lines.push(`/menu — главное меню`);

                await sendNotification(bot, chatId, lines.join('\n'));
                knownAds[ad.id] = {
                    title: ad.title,
                    price: ad.price,
                    location: ad.location,
                    time: ad.time,
                    link: ad.link,
                    sent_at: Date.now(),
                };
            }
            storage.saveAds(chatId, knownAds);
            console.log(`[Parser] Пользователь ${chatId}: ${newEntries.length} новых объявлений`);
        }
    } catch (error) {
        console.error(`[Parser] Ошибка проверки пользователя ${chatId}: ${error.message}`);
    }
}

async function checkAllUsers(bot) {
    const users = storage.getUsers();
    const activeUsers = Object.entries(users).filter(([, u]) => u.monitoring && u.url);

    if (activeUsers.length === 0) return;

    console.log(`[Parser] Проверка ${activeUsers.length} активных пользователей...`);

    for (const [chatId, user] of activeUsers) {
        await checkUser(bot, chatId, user);
    }
}

async function main() {
    console.log(`[${new Date().toISOString()}] Запуск KufarParser...`);

    await parser.initParser(puppeteer);

    const bot = createBot(TELEGRAM_BOT_TOKEN);
    activeBot = bot;
    bot.launch();
    console.log('[Bot] Telegram-бот запущен.');

    const users = storage.getUsers();
    for (const chatId of Object.keys(users)) {
        storage.clearAds(chatId);
        if (users[chatId].monitoring) {
            storage.updateUser(chatId, { monitoring_started_at: Date.now() });
        }
    }
    console.log('[Parser] Кэш объявлений очищен, monitoring_started_at обновлён.');

    await checkAllUsers(bot);

    setInterval(() => checkAllUsers(bot), 10 * 1000);
    console.log(`[${new Date().toISOString()}] Мониторинг запущен. Используйте /menu в Telegram.`);
}

process.on('SIGINT', async () => {
    console.log('\n[Parser] Завершение работы...');
    if (activeBot) activeBot.stop();
    await parser.closeParser().catch(() => {});
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[Parser] Завершение работы...');
    if (activeBot) activeBot.stop();
    await parser.closeParser().catch(() => {});
    process.exit(0);
});

main().catch(error => {
    console.error(`[Parser] Критическая ошибка: ${error.message}`);
    process.exit(1);
});
