const { Telegraf, Markup } = require('telegraf');
const storage = require('./storage');
const parser = require('./parser');

function createBot(token) {
    const bot = new Telegraf(token);

    // === /start ===
    bot.start((ctx) => {
        const chatId = ctx.chat.id;
        storage.createUser(chatId);
        ctx.reply(
            'Добро пожаловать в KufarParser!\n\n' +
            'Этот бот мониторит объявления на kufar.by\n' +
            'и отправляет уведомления о новых.',
            mainMenuKeyboard()
        );
    });

    // === /menu — главное меню ===
    bot.command('/menu', (ctx) => {
        ctx.reply('Главное меню:', mainMenuKeyboard());
    });

    // === /help ===
    bot.command('/help', (ctx) => {
        ctx.reply(
            'Команды:\n' +
            '/menu — главное меню\n' +
            '/status — текущий статус\n' +
            '/help — эта справка\n\n' +
            'Используйте кнопки для навигации.',
            mainMenuKeyboard()
        );
    });

    // === /status ===
    bot.command('/status', (ctx) => {
        const chatId = ctx.chat.id;
        const user = storage.createUser(chatId);
        const knownAds = storage.loadAds(chatId);
        const adsCount = Object.keys(knownAds).length;

        ctx.reply(
            'Статус:\n\n' +
            `URL: ${user.url || 'не задан'}\n` +
            `Мониторинг: ${user.monitoring ? 'активен' : 'остановлен'}\n` +
            `Объявлений в кэше: ${adsCount}`,
            mainMenuKeyboard()
        );
    });

    // === Callback queries (inline buttons) ===
    bot.on('callback_query', async (ctx) => {
        const chatId = ctx.chat.id;
        const data = ctx.callbackQuery.data;
        storage.createUser(chatId);

        try {
            await ctx.answerCbQuery();

            if (data === 'menu') {
                await ctx.editMessageText('Главное меню:', mainMenuKeyboard());
                return;
            }

            if (data === 'categories') {
                await handleCategories(ctx, chatId);
                return;
            }

            if (data === 'my_filters') {
                await handleMyFilters(ctx, chatId);
                return;
            }

            if (data === 'monitoring') {
                await handleMonitoring(ctx, chatId);
                return;
            }

            if (data === 'start_monitoring') {
                await handleStartMonitoring(ctx, chatId);
                return;
            }

            if (data === 'stop_monitoring') {
                await handleStopMonitoring(ctx, chatId);
                return;
            }

            if (data.startsWith('cat:')) {
                await handleCategorySelected(ctx, chatId, data.slice(4));
                return;
            }

            if (data.startsWith('filter:')) {
                await handleFilterToggled(ctx, chatId, data.slice(7));
                return;
            }

            if (data === 'filters_done') {
                await handleFiltersDone(ctx, chatId);
                return;
            }

            if (data === 'filters_reset') {
                await handleFiltersReset(ctx, chatId);
                return;
            }

            if (data === 'confirm_url') {
                await handleConfirmUrl(ctx, chatId);
                return;
            }

            if (data === 'back_to_categories') {
                await handleCategories(ctx, chatId);
                return;
            }

            if (data === 'back_to_menu') {
                await ctx.editMessageText('Главное меню:', mainMenuKeyboard());
                return;
            }

        } catch (error) {
            console.error(`[Bot] Ошибка callback: ${error.message}`);
            await ctx.reply('Произошла ошибка. Попробуйте снова.', mainMenuKeyboard());
        }
    });

    // === Обработчики кнопок ===

    async function handleCategories(ctx, chatId) {
        await ctx.editMessageText('Загрузка категорий...');

        const categories = await parser.getCategories();

        if (!categories || categories.length === 0) {
            await ctx.editMessageText(
                'Не удалось загрузить категории.\nПопробуйте позже.',
                mainMenuKeyboard()
            );
            return;
        }

        const keyboard = Markup.inlineKeyboard(
            [
                ...categories.map(c => [
                    Markup.button.callback(c.name, `cat:${c.slug}`)
                ]),
                [Markup.button.callback('← Назад', 'back_to_menu')],
            ]
        );

        await ctx.editMessageText('Выберите категорию:', keyboard);
    }

    async function handleCategorySelected(ctx, chatId, slug) {
        const session = storage.updateSession(chatId, {
            selectedCategory: slug,
            selectedFilters: {},
            step: 'filters',
        });

        await ctx.editMessageText(`Загрузка фильтров для "${slug}"...`);

        const categoryUrl = `https://www.kufar.by/l/${slug}`;
        const filters = await parser.getFilters(categoryUrl);

        const keyboard = buildFilterKeyboard(filters, session.selectedFilters);

        await ctx.editMessageText(
            `Категория: ${slug}\n\nВыберите фильтры (нажимайте для выбора/отмены):`,
            keyboard
        );
    }

    async function handleFilterToggled(ctx, chatId, filterKey) {
        const session = storage.getSession(chatId);
        const [type, value] = filterKey.split('|');

        if (!session.selectedFilters[type]) {
            session.selectedFilters[type] = [];
        }

        const arr = session.selectedFilters[type];
        const idx = arr.indexOf(value);
        if (idx >= 0) {
            arr.splice(idx, 1);
        } else {
            arr.push(value);
        }

        if (arr.length === 0) delete session.selectedFilters[type];

        const categoryUrl = `https://www.kufar.by/l/${session.selectedCategory}`;
        const filters = await parser.getFilters(categoryUrl);
        const keyboard = buildFilterKeyboard(filters, session.selectedFilters);

        const summary = formatFilterSummary(session.selectedFilters);

        await ctx.editMessageText(
            `Категория: ${session.selectedCategory}\n\n` +
            (summary ? `Выбрано:\n${summary}\n\n` : '') +
            `Выберите фильтры:`,
            keyboard
        );
    }

    async function handleFiltersDone(ctx, chatId) {
        const session = storage.getSession(chatId);

        if (!session.selectedCategory) {
            await ctx.editMessageText('Сначала выберите категорию.', mainMenuKeyboard());
            return;
        }

        const url = parser.buildUrl(session.selectedCategory, {
            selected: session.selectedFilters,
        });

        storage.updateUser(chatId, { url });

        const summary = formatFilterSummary(session.selectedFilters);

        await ctx.editMessageText(
            `Готово! Ваш URL:\n${url}\n\n` +
            (summary ? `Фильтры:\n${summary}\n\n` : '') +
            `Запустить мониторинг?`,
            Markup.inlineKeyboard([
                [Markup.button.callback('Запустить мониторинг', 'start_monitoring')],
                [Markup.button.callback('Изменить фильтры', `cat:${session.selectedCategory}`)],
                [Markup.button.callback('← В меню', 'back_to_menu')],
            ])
        );

        storage.resetSession(chatId);
    }

    async function handleFiltersReset(ctx, chatId) {
        const session = storage.getSession(chatId);
        session.selectedFilters = {};

        const categoryUrl = `https://www.kufar.by/l/${session.selectedCategory}`;
        const filters = await parser.getFilters(categoryUrl);
        const keyboard = buildFilterKeyboard(filters, {});

        await ctx.editMessageText(
            `Категория: ${session.selectedCategory}\n\nФильтры сброшены. Выберите заново:`,
            keyboard
        );
    }

    async function handleMonitoring(ctx, chatId) {
        const user = storage.getUser(chatId);

        if (!user) {
            await ctx.reply('Сначала нажмите /start', mainMenuKeyboard());
            return;
        }

        const statusText = user.monitoring
            ? `Мониторинг активен.\nURL: ${user.url || 'не задан'}`
            : `Мониторинг остановлен.\nURL: ${user.url || 'не задан'}`;

        const buttons = [];
        if (user.monitoring) {
            buttons.push([Markup.button.callback('Остановить', 'stop_monitoring')]);
        } else {
            buttons.push([Markup.button.callback('Запустить', 'start_monitoring')]);
        }
        buttons.push([Markup.button.callback('← Назад', 'back_to_menu')]);

        await ctx.editMessageText(statusText, Markup.inlineKeyboard(buttons));
    }

    async function handleStartMonitoring(ctx, chatId) {
        const user = storage.getUser(chatId);

        if (!user || !user.url) {
            await ctx.reply(
                'Сначала задайте URL через категории.',
                mainMenuKeyboard()
            );
            return;
        }

        storage.updateUser(chatId, { monitoring: true });

        await ctx.editMessageText(
            `Мониторинг запущен!\nURL: ${user.url}\nПроверка каждые 10 секунд.`,
            mainMenuKeyboard()
        );
    }

    async function handleStopMonitoring(ctx, chatId) {
        storage.updateUser(chatId, { monitoring: false });
        await ctx.editMessageText('Мониторинг остановлен.', mainMenuKeyboard());
    }

    async function handleConfirmUrl(ctx, chatId) {
        const user = storage.getUser(chatId);
        if (!user || !user.url) return;

        storage.updateUser(chatId, { monitoring: true });
        await ctx.editMessageText(
            `Мониторинг запущен!\nURL: ${user.url}`,
            mainMenuKeyboard()
        );
    }

    // === Вспомогательные функции ===

    function mainMenuKeyboard() {
        return Markup.inlineKeyboard([
            [Markup.button.callback('Категории', 'categories')],
            [Markup.button.callback('Мои фильтры', 'my_filters')],
            [Markup.button.callback('Мониторинг', 'monitoring')],
        ]);
    }

    function buildFilterKeyboard(filters, selected) {
        const rows = [];

        if (filters.brands && filters.brands.length > 0) {
            rows.push([Markup.button.callback('--- Бренды ---', 'noop')]);
            for (const brand of filters.brands) {
                const isSelected = selected.brand && selected.brand.includes(brand.label);
                const prefix = isSelected ? '✓ ' : '';
                rows.push([
                    Markup.button.callback(
                        `${prefix}${brand.label}`,
                        `filter:brand|${brand.label}`
                    ),
                ]);
            }
        }

        if (rows.length > 0) {
            rows.push([]);
        }

        rows.push([
            Markup.button.callback('Готово', 'filters_done'),
            Markup.button.callback('Сбросить', 'filters_reset'),
        ]);
        rows.push([Markup.button.callback('← К категориям', 'back_to_categories')]);

        return Markup.inlineKeyboard(rows);
    }

    function formatFilterSummary(filters) {
        const parts = [];
        for (const [type, values] of Object.entries(filters)) {
            if (Array.isArray(values) && values.length > 0) {
                parts.push(`${type}: ${values.join(', ')}`);
            }
        }
        return parts.join('\n');
    }

    return bot;
}

module.exports = { createBot };
