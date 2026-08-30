require('dotenv').config();
const puppeteer = require('puppeteer');
const { createBot } = require('./bot');
const parser = require('./parser');
const storage = require('./storage');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

let activeBot = null;

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

        const newEntries = ads.filter(ad => !knownAds[ad.id]);

        if (newEntries.length > 0) {
            for (const ad of newEntries) {
                const lines = [];
                lines.push(`📱 Новое объявление`);
                lines.push(``);
                lines.push(`Название публикации: ${ad.title}`);
                lines.push(`Цена: ${ad.price}`);
                if (ad.location) lines.push(`Регион: ${ad.location}`);
                if (ad.time) lines.push(`Время: ${ad.time}`);
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

    // Инициализация браузера для парсинга
    await parser.initParser(puppeteer);

    // Инициализация Telegram-бота
    const bot = createBot(TELEGRAM_BOT_TOKEN);
    activeBot = bot;
    bot.launch();
    console.log('[Bot] Telegram-бот запущен.');

    // Очистка кэша при перезапуске — чтобы не спамить старыми объявлениями
    const users = storage.getUsers();
    for (const chatId of Object.keys(users)) {
        storage.clearAds(chatId);
    }
    console.log('[Parser] Кэш объявлений очищен.');

    // Первый запуск проверки
    await checkAllUsers(bot);

    // Проверка каждые 10 секунд
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
