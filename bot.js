const { Telegraf, Markup } = require('telegraf');
const storage = require('./storage');
const parser = require('./parser');

function createBot(token) {
    const bot = new Telegraf(token);

    const menuBtn = () => [Markup.button.callback('🏠 В меню', 'menu')];

    function mainMenuKeyboardFor(chatId) {
        const user = storage.getUser(chatId);
        return Markup.inlineKeyboard([
            [Markup.button.callback('📱 Фильтры', 'filters')],
            [Markup.button.callback(
                user?.monitoring ? '⏹ Остановить мониторинг' : '▶️ Запустить мониторинг',
                user?.monitoring ? 'stop_monitoring' : 'start_monitoring'
            )],
        ]);
    }

    bot.start((ctx) => {
        const chatId = ctx.chat.id;
        storage.createUser(chatId);
        ctx.reply(
            '📱 KufarParser — Мобильные телефоны\n\n' +
            'Бот мониторит объявления мобильных телефонов на kufar.by\n' +
            'и отправляет уведомления о новых.',
            mainMenuKeyboardFor(chatId)
        );
    });

    bot.command('start', (ctx) => {
        const chatId = ctx.chat.id;
        storage.createUser(chatId);
        ctx.reply(
            '📱 KufarParser — Мобильные телефоны\n\n' +
            'Бот мониторит объявления мобильных телефонов на kufar.by\n' +
            'и отправляет уведомления о новых.',
            mainMenuKeyboardFor(chatId)
        );
    });

    bot.command('menu', (ctx) => {
        const chatId = ctx.chat.id;
        storage.createUser(chatId);
        ctx.reply('Главное меню:', mainMenuKeyboardFor(chatId));
    });

    bot.command('help', (ctx) => {
        ctx.reply(
            'Команды:\n' +
            '/menu — главное меню\n' +
            '/status — текущий статус\n' +
            '/help — эта справка\n\n' +
            'Используйте кнопки для навигации.'
        );
    });

    bot.command('status', (ctx) => {
        const chatId = ctx.chat.id;
        const user = storage.createUser(chatId);
        const knownAds = storage.loadAds(chatId);
        const adsCount = Object.keys(knownAds).length;

        let text = '📊 Статус:\n\n';
        text += `Мониторинг: ${user.monitoring ? '✅ активен' : '⛔ остановлен'}\n`;
        if (user.url) text += `URL: ${user.url}\n`;
        text += `Объявлений в кэше: ${adsCount}\n`;

        ctx.reply(text, mainMenuKeyboardFor(chatId));
    });

    bot.on('callback_query', async (ctx) => {
        const chatId = ctx.chat.id;
        const data = ctx.callbackQuery.data;
        storage.createUser(chatId);

        try {
            await ctx.answerCbQuery();

            if (data === 'menu') {
                await ctx.reply('Главное меню:', mainMenuKeyboardFor(chatId));
                return;
            }

            if (data === 'filters') {
                await sendFiltersSummary(ctx, chatId);
                return;
            }

            if (data === 'select_brand') {
                await handleSelectBrand(ctx, chatId);
                return;
            }

            if (data.startsWith('brand:')) {
                await handleBrandSelected(ctx, chatId, data.slice(6));
                return;
            }

            if (data === 'select_model') {
                await handleSelectModel(ctx, chatId);
                return;
            }

            if (data.startsWith('model:')) {
                await handleModelToggled(ctx, chatId, data.slice(6));
                return;
            }

            if (data === 'set_price') {
                await handleSetPrice(ctx, chatId);
                return;
            }

            if (data === 'clear_price') {
                const session = storage.getSession(chatId);
                session.priceFrom = null;
                session.priceTo = null;
                await sendFiltersSummary(ctx, chatId);
                return;
            }

            if (data === 'rgn_list') {
                await handleRegionList(ctx, chatId);
                return;
            }

            if (data.startsWith('rgn_toggle:')) {
                await handleRegionToggle(ctx, chatId, parseInt(data.slice(11), 10));
                return;
            }

            if (data.startsWith('rgn_cities:')) {
                await handleRegionCities(ctx, chatId, parseInt(data.slice(11), 10));
                return;
            }

            if (data.startsWith('ar_toggle:')) {
                const parts = data.slice(10).split(':');
                await handleAreaToggled(ctx, chatId, parseInt(parts[0], 10), parseInt(parts[1], 10));
                return;
            }

            if (data === 'rgn_back') {
                await handleRegionList(ctx, chatId);
                return;
            }

            if (data === 'rgn_all') {
                await handleRegionAll(ctx, chatId);
                return;
            }

            if (data === 'build_url') {
                await handleBuildUrl(ctx, chatId);
                return;
            }

            if (data === 'reset_filters') {
                storage.resetSession(chatId);
                storage.updateUser(chatId, { url: '', monitoring: false });
                await sendFiltersSummary(ctx, chatId);
                return;
            }

            if (data === 'start_monitoring') {
                await handleStartMonitoring(ctx, chatId);
                return;
            }

            if (data === 'stop_monitoring') {
                storage.updateUser(chatId, { monitoring: false });
                await ctx.reply('⏹ Мониторинг остановлен.', mainMenuKeyboardFor(chatId));
                return;
            }

        } catch (error) {
            console.error(`[Bot] Ошибка callback: ${error.message}`);
            ctx.reply('Произошла ошибка. Попробуйте /menu.', mainMenuKeyboardFor(chatId));
        }
    });

    bot.on('text', async (ctx) => {
        const chatId = ctx.chat.id;
        const session = storage.getSession(chatId);
        const text = ctx.message.text.trim();

        if (session.waitingFor === 'price_from') {
            const val = parseInt(text.replace(/\D/g, ''), 10);
            if (!isNaN(val) && val >= 0) {
                session.priceFrom = val;
                session.waitingFor = 'price_to';
                ctx.reply('💰 Максимальная цена (или отправьте "0" для пропуска):');
            } else {
                ctx.reply('Введите число или "0" для пропуска:');
            }
            return;
        }

        if (session.waitingFor === 'price_to') {
            if (text === '0' || text === '-' || text.toLowerCase() === 'пропустить') {
                session.priceTo = null;
            } else {
                const val = parseInt(text.replace(/\D/g, ''), 10);
                if (!isNaN(val) && val >= 0) {
                    session.priceTo = val;
                }
            }
            session.waitingFor = null;
            await sendFiltersSummary(ctx, chatId);
            return;
        }
    });

    // === Фильтры: сводка ===

    async function sendFiltersSummary(ctx, chatId) {
        const session = storage.getSession(chatId);
        const user = storage.getUser(chatId);
        const lines = [];

        if (session.brandName) lines.push(`📱 Бренд: ${session.brandName}`);
        if (session.modelNames && session.modelNames.length > 0) {
            lines.push(`📋 Модели: ${session.modelNames.join(', ')}`);
        }

        const regionSummary = buildRegionSummary(session);
        if (regionSummary) lines.push(`📍 Регион: ${regionSummary}`);

        if (session.priceFrom || session.priceTo) {
            const from = session.priceFrom || 0;
            lines.push(`💰 Цена: ${from} — ${session.priceTo || '∞'} BYN`);
        }

        const hasActiveFilters = lines.length > 0;
        const hasStoredUrl = user && user.url;

        let text;
        if (hasActiveFilters) {
            text = `📱 Мобильные телефоны\n\nТекущие фильтры:\n${lines.map(l => '• ' + l).join('\n')}\n\nВыберите или измените фильтры:`;
        } else if (hasStoredUrl) {
            text = `📱 Мобильные телефоны\n\nТекущий URL:\n${user.url}\n\nФильтры настроены через URL. Нажмите кнопку для изменения:`;
        } else {
            text = '📱 Мобильные телефоны\n\nФильтры не заданы (показаны все объявления).\nНажмите кнопку для настройки:';
        }

        const regionCount = countSelectedRegions(session);
        const rows = [];

        rows.push([Markup.button.callback(
            `🏷 Бренд${session.brandName ? ': ' + session.brandName : ''}`,
            'select_brand'
        )]);

        if (session.brand) {
            rows.push([Markup.button.callback(
                `📋 Модели (${session.models.length})`,
                'select_model'
            )]);
        }

        const rgnLabel = regionCount > 0 ? `📍 Регион (${regionCount})` : '📍 Регион';
        rows.push([Markup.button.callback(rgnLabel, 'rgn_list')]);

        const priceActive = session.priceFrom || session.priceTo;
        const priceLabel = priceActive
            ? `💰 Цена: ${session.priceFrom || 0}—${session.priceTo || '∞'}`
            : '💰 Цена';
        rows.push([Markup.button.callback(priceLabel, 'set_price')]);

        rows.push([]);
        rows.push([Markup.button.callback('✅ Построить URL и запустить', 'build_url')]);
        rows.push([Markup.button.callback('🔄 Сбросить фильтры', 'reset_filters')]);
        rows.push(menuBtn());

        await ctx.reply(text, Markup.inlineKeyboard(rows));
    }

    function buildRegionSummary(session) {
        if (!session.regions) return null;

        const parts = [];
        for (const [regionId, region] of Object.entries(session.regions)) {
            const hasSelectedAreas = region.areas && Object.values(region.areas).some(a => a.selected);

            if (region.selected) {
                parts.push(region.name);
            } else if (hasSelectedAreas) {
                const areaNames = Object.values(region.areas)
                    .filter(a => a.selected)
                    .map(a => a.name);
                if (areaNames.length > 0) {
                    parts.push(`${region.name} (${areaNames.join(', ')})`);
                }
            }
        }

        return parts.length > 0 ? parts.join(', ') : null;
    }

    function countSelectedRegions(session) {
        if (!session.regions) return 0;
        let count = 0;
        for (const region of Object.values(session.regions)) {
            if (region.selected) {
                count++;
            } else if (region.areas) {
                count += Object.values(region.areas).filter(a => a.selected).length;
            }
        }
        return count;
    }

    // === Бренд ===

    async function handleSelectBrand(ctx, chatId) {
        const brands = await parser.getBrands();
        if (brands.length === 0) {
            ctx.reply('Не удалось загрузить бренды.', mainMenuKeyboardFor(chatId));
            return;
        }

        const session = storage.getSession(chatId);
        const rows = [];
        for (const brand of brands) {
            const prefix = session.brand === brand.id ? '✓ ' : '';
            rows.push([Markup.button.callback(`${prefix}${brand.name}`, `brand:${brand.id}`)]);
        }
        rows.push(menuBtn());

        await ctx.reply('🏷 Выберите бренд:', Markup.inlineKeyboard(rows));
    }

    async function handleBrandSelected(ctx, chatId, brandId) {
        const brandIdNum = parseInt(brandId, 10);
        const brands = await parser.getBrands();
        const brand = brands.find(b => b.id === brandIdNum);
        const session = storage.getSession(chatId);

        if (session.brand === brandIdNum) {
            session.brand = null;
            session.brandName = null;
            session.models = [];
            session.modelNames = [];
        } else {
            session.brand = brandIdNum;
            session.brandName = brand ? brand.name : brandId;
            session.models = [];
            session.modelNames = [];
        }

        await sendFiltersSummary(ctx, chatId);
    }

    // === Модели ===

    async function handleSelectModel(ctx, chatId) {
        const session = storage.getSession(chatId);
        if (!session.brand) {
            ctx.reply('Сначала выберите бренд.', mainMenuKeyboardFor(chatId));
            return;
        }

        const models = await parser.getModels(session.brand);
        if (models.length === 0) {
            ctx.reply('Нет моделей для этого бренда.', mainMenuKeyboardFor(chatId));
            return;
        }

        const rows = [];
        for (const model of models) {
            const isSelected = session.models.includes(model.id);
            const prefix = isSelected ? '✓ ' : '';
            rows.push([Markup.button.callback(`${prefix}${model.name}`, `model:${model.id}`)]);
        }
        rows.push(menuBtn());

        await ctx.reply('📋 Выберите модели (можно несколько):', Markup.inlineKeyboard(rows));
    }

    async function handleModelToggled(ctx, chatId, modelId) {
        const modelIdNum = parseInt(modelId, 10);
        const session = storage.getSession(chatId);
        const models = await parser.getModels(session.brand);
        const model = models.find(m => m.id === modelIdNum);

        const idx = session.models.indexOf(modelIdNum);
        if (idx >= 0) {
            session.models.splice(idx, 1);
            if (model) {
                const nameIdx = session.modelNames.indexOf(model.name);
                if (nameIdx >= 0) session.modelNames.splice(nameIdx, 1);
            }
        } else {
            session.models.push(modelIdNum);
            if (model) session.modelNames.push(model.name);
        }

        const rows = [];
        for (const m of models) {
            const isSelected = session.models.includes(m.id);
            const prefix = isSelected ? '✓ ' : '';
            rows.push([Markup.button.callback(`${prefix}${m.name}`, `model:${m.id}`)]);
        }
        rows.push(menuBtn());

        await ctx.reply('📋 Выберите модели:', Markup.inlineKeyboard(rows));
    }

    // === Цена ===

    async function handleSetPrice(ctx, chatId) {
        const session = storage.getSession(chatId);
        session.waitingFor = 'price_from';
        ctx.reply(
            '💰 Введите минимальную цену (в BYN):\n' +
            'Или отправьте "0" для пропуска.'
        );
    }

    // === Регионы ===

    async function handleRegionList(ctx, chatId) {
        const regions = parser.getRegions();
        const session = storage.getSession(chatId);

        if (!session.regions) session.regions = {};

        const rows = [];
        rows.push([Markup.button.callback('🌐 Вся Беларусь', 'rgn_all')]);

        for (const rgn of regions) {
            const regionState = session.regions[rgn.id];
            const isWholeSelected = regionState?.selected;
            const areasCount = regionState?.areas
                ? Object.values(regionState.areas).filter(a => a.selected).length
                : 0;

            let label = rgn.name;
            if (isWholeSelected) {
                label = `✓ ${rgn.name} (вся область)`;
            } else if (areasCount > 0) {
                label = `${rgn.name} (${areasCount})`;
            }

            rows.push([Markup.button.callback(label, `rgn_cities:${rgn.id}`)]);
        }

        rows.push(menuBtn());

        const summary = buildRegionSummary(session);
        const text = summary
            ? `📍 Выберите регион\n\nТекущий выбор: ${summary}\n\nНажмите на область для выбора городов:`
            : '📍 Выберите регион:\n\nНажмите на область для выбора городов:';

        await ctx.reply(text, Markup.inlineKeyboard(rows));
    }

    async function handleRegionCities(ctx, chatId, regionId) {
        const regions = parser.getRegions();
        const region = regions.find(r => r.id === regionId);
        if (!region) return;

        const areas = await parser.getAreas(regionId);
        if (areas.length === 0) {
            ctx.reply('Нет городов для этого региона.', mainMenuKeyboardFor(chatId));
            return;
        }

        const session = storage.getSession(chatId);
        if (!session.regions) session.regions = {};
        if (!session.regions[regionId]) {
            session.regions[regionId] = { name: region.name, selected: false, areas: {} };
        }

        const regionState = session.regions[regionId];

        const rows = [];

        const wholeLabel = regionState.selected
            ? `✓ ${region.name} (вся область)`
            : `${region.name} (вся область)`;
        rows.push([Markup.button.callback(wholeLabel, `rgn_toggle:${regionId}`)]);

        for (const area of areas) {
            if (!regionState.areas[area.id]) {
                regionState.areas[area.id] = { name: area.name, selected: false };
            }
            const isSelected = regionState.areas[area.id].selected;
            const prefix = isSelected ? '✓ ' : '';
            rows.push([Markup.button.callback(`${prefix}${area.name}`, `ar_toggle:${regionId}:${area.id}`)]);
        }

        rows.push([Markup.button.callback('← Назад к регионам', 'rgn_back')]);
        rows.push(menuBtn());

        const selectedAreas = Object.values(regionState.areas).filter(a => a.selected).map(a => a.name);
        const text = selectedAreas.length > 0
            ? `📍 ${region.name}\n\nВыбрано: ${selectedAreas.join(', ')}\n\nВыберите города:`
            : `📍 ${region.name}\n\nВыберите города:`;

        await ctx.reply(text, Markup.inlineKeyboard(rows));
    }

    async function handleRegionToggle(ctx, chatId, regionId) {
        const regions = parser.getRegions();
        const region = regions.find(r => r.id === regionId);
        if (!region) return;

        const session = storage.getSession(chatId);
        if (!session.regions) session.regions = {};
        if (!session.regions[regionId]) {
            session.regions[regionId] = { name: region.name, selected: false, areas: {} };
        }

        const regionState = session.regions[regionId];
        regionState.selected = !regionState.selected;

        if (regionState.selected) {
            for (const areaId of Object.keys(regionState.areas)) {
                regionState.areas[areaId].selected = false;
            }
        }

        await handleRegionCities(ctx, chatId, regionId);
    }

    async function handleAreaToggled(ctx, chatId, regionId, areaId) {
        const regions = parser.getRegions();
        const region = regions.find(r => r.id === regionId);
        if (!region) return;

        const session = storage.getSession(chatId);
        if (!session.regions) session.regions = {};
        if (!session.regions[regionId]) {
            session.regions[regionId] = { name: region.name, selected: false, areas: {} };
        }

        const regionState = session.regions[regionId];
        regionState.selected = false;

        if (!regionState.areas[areaId]) {
            const areas = await parser.getAreas(regionId);
            const area = areas.find(a => a.id === areaId);
            regionState.areas[areaId] = { name: area ? area.name : String(areaId), selected: false };
        }

        regionState.areas[areaId].selected = !regionState.areas[areaId].selected;

        await handleRegionCities(ctx, chatId, regionId);
    }

    async function handleRegionAll(ctx, chatId) {
        const session = storage.getSession(chatId);
        session.regions = {};
        await sendFiltersSummary(ctx, chatId);
    }

    // === Построение URL ===

    async function handleBuildUrl(ctx, chatId) {
        const session = storage.getSession(chatId);

        const allAreas = [];
        if (session.regions) {
            for (const [regionId, region] of Object.entries(session.regions)) {
                if (region.selected) {
                    const areas = await parser.getAreas(parseInt(regionId, 10));
                    for (const area of areas) {
                        allAreas.push(area.id);
                    }
                } else if (region.areas) {
                    for (const [areaId, area] of Object.entries(region.areas)) {
                        if (area.selected) allAreas.push(parseInt(areaId, 10));
                    }
                }
            }
        }

        const filters = {};
        if (session.brand) filters.brand = session.brand;
        if (session.models && session.models.length > 0) filters.models = session.models;
        if (session.priceFrom) filters.priceFrom = session.priceFrom;
        if (session.priceTo) filters.priceTo = session.priceTo;
        if (allAreas.length > 0) filters.areas = allAreas;

        const url = parser.buildUrl(filters);
        storage.updateUser(chatId, { url });

        const lines = [];
        if (session.brandName) lines.push(`Бренд: ${session.brandName}`);
        if (session.modelNames?.length) lines.push(`Модели: ${session.modelNames.join(', ')}`);
        const regionSummary = buildRegionSummary(session);
        if (regionSummary) lines.push(`Регион: ${regionSummary}`);
        if (session.priceFrom || session.priceTo) lines.push(`Цена: ${session.priceFrom || 0} — ${session.priceTo || '∞'} BYN`);

        const text = '✅ URL сформирован!\n\n' +
            (lines.length > 0 ? `Фильтры:\n${lines.map(l => '• ' + l).join('\n')}\n\n` : '') +
            `URL:\n${url}`;

        await ctx.reply(text, Markup.inlineKeyboard([
            [Markup.button.callback('▶️ Запустить мониторинг', 'start_monitoring')],
            [Markup.button.callback('📱 Изменить фильтры', 'filters')],
            menuBtn(),
        ]));
    }

    // === Мониторинг ===

    async function handleStartMonitoring(ctx, chatId) {
        const user = storage.getUser(chatId);
        const session = storage.getSession(chatId);

        let url = user?.url;

        if (!url) {
            const allAreas = [];
            if (session.regions) {
                for (const [regionId, region] of Object.entries(session.regions)) {
                    if (region.selected) {
                        const areas = await parser.getAreas(parseInt(regionId, 10));
                        for (const area of areas) {
                            allAreas.push(area.id);
                        }
                    } else if (region.areas) {
                        for (const [areaId, area] of Object.entries(region.areas)) {
                            if (area.selected) allAreas.push(parseInt(areaId, 10));
                        }
                    }
                }
            }

            const filters = {};
            if (session.brand) filters.brand = session.brand;
            if (session.models && session.models.length > 0) filters.models = session.models;
            if (session.priceFrom) filters.priceFrom = session.priceFrom;
            if (session.priceTo) filters.priceTo = session.priceTo;
            if (allAreas.length > 0) filters.areas = allAreas;

            url = parser.buildUrl(filters);
            storage.updateUser(chatId, { url });
        }

        storage.clearAds(chatId);
        storage.updateUser(chatId, { monitoring: true, monitoring_started_at: Date.now() });

        await ctx.reply(
            `▶️ Мониторинг запущен!\n\nURL: ${url}\nПроверка каждые 10 секунд.`,
            mainMenuKeyboardFor(chatId)
        );
    }

    return bot;
}

module.exports = { createBot };
