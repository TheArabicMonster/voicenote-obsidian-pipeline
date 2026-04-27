const fs = require('fs');
const path = require('path');

function getCategoriesFile() {
    return process.env.CATEGORIES_FILE || path.join(process.env.VAULT_PATH || '', 'categories.json');
}

function loadCategories() {
    const file = getCategoriesFile();
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.categories || [];
}

function addCategory(categoryPath, description) {
    const file = getCategoriesFile();
    let data = { version: 0, categories: [] };
    if (fs.existsSync(file)) {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    const today = new Date().toISOString().slice(0, 10);
    data.categories.push({
        path: categoryPath,
        description,
        created_at: today,
        created_by: 'voicenote-bot',
        validated_by: 'user',
    });
    data.version = (data.version || 0) + 1;
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');

    // Créer le dossier physique dans la vault
    const vaultPath = process.env.VAULT_PATH || '';
    const dirPath = path.join(vaultPath, categoryPath);
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`[categories] Nouvelle catégorie créée : ${categoryPath}`);
}

function initCategories(vaultPath, initialCategories) {
    // initialCategories = array of strings like "Projets/Tech"
    const file = path.join(vaultPath, 'categories.json');
    if (fs.existsSync(file)) return;

    const today = new Date().toISOString().slice(0, 10);
    const categories = initialCategories.map(cat => ({
        path: cat.trim(),
        description: '',
        created_at: today,
        created_by: 'init',
    }));

    const data = { version: 1, categories };
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');

    for (const cat of categories) {
        fs.mkdirSync(path.join(vaultPath, cat.path), { recursive: true });
    }
    console.log(`[categories] ${categories.length} catégorie(s) initiale(s) créée(s)`);
}

module.exports = { loadCategories, addCategory, initCategories };
