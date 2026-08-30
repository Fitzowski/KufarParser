const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const AD_TTL = 60 * 24 * 60 * 60 * 1000;
const CACHE_TTL = 60 * 60 * 1000;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function readJSON(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (error) {
        console.error(`Ошибка чтения ${filePath}: ${error.message}`);
        return null;
    }
}

function writeJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        console.error(`Ошибка записи ${filePath}: ${error.message}`);
    }
}

function getUsers() {
    return readJSON(USERS_FILE) || {};
}

function saveUsers(users) {
    writeJSON(USERS_FILE, users);
}

function getUser(chatId) {
    const users = getUsers();
    return users[String(chatId)] || null;
}

function createUser(chatId) {
    const users = getUsers();
    const id = String(chatId);
    if (!users[id]) {
        users[id] = {
            url: '',
            monitoring: false,
            created_at: Date.now(),
        };
        saveUsers(users);
    }
    return users[id];
}

function updateUser(chatId, data) {
    const users = getUsers();
    const id = String(chatId);
    if (!users[id]) return null;
    Object.assign(users[id], data);
    saveUsers(users);
    return users[id];
}

function getAdsFilePath(chatId) {
    return path.join(DATA_DIR, `ads_${chatId}.json`);
}

function loadAds(chatId) {
    const data = readJSON(getAdsFilePath(chatId));
    if (!data) return {};
    const now = Date.now();
    const filtered = {};
    for (const [id, ad] of Object.entries(data)) {
        if (now - ad.sent_at < AD_TTL) {
            filtered[id] = ad;
        }
    }
    return filtered;
}

function saveAds(chatId, ads) {
    writeJSON(getAdsFilePath(chatId), ads);
}

function clearAds(chatId) {
    const filePath = getAdsFilePath(chatId);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

function getCache(key) {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    const data = readJSON(filePath);
    if (!data || !data.updatedAt) return null;
    if (Date.now() - data.updatedAt > CACHE_TTL) return null;
    return data.payload;
}

function setCache(key, payload) {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    writeJSON(filePath, { updatedAt: Date.now(), payload });
}

const sessions = {};

function createDefaultSession() {
    return {
        brand: null,
        brandName: null,
        models: [],
        modelNames: [],
        priceFrom: null,
        priceTo: null,
        waitingFor: null,
        regions: {},
        regionView: null,
    };
}

function getSession(chatId) {
    const id = String(chatId);
    if (!sessions[id]) {
        sessions[id] = createDefaultSession();
    }
    return sessions[id];
}

function updateSession(chatId, data) {
    const id = String(chatId);
    const session = getSession(id);
    Object.assign(session, data);
    return session;
}

function resetSession(chatId) {
    const id = String(chatId);
    sessions[id] = createDefaultSession();
    return sessions[id];
}

module.exports = {
    getUsers,
    saveUsers,
    getUser,
    createUser,
    updateUser,
    loadAds,
    saveAds,
    clearAds,
    getCache,
    setCache,
    getSession,
    updateSession,
    resetSession,
};
