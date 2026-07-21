'use strict';

const fs = require('fs');
const path = require('path');
const { DECK_LABELS } = require('./deckRegistry.js');

const DEFAULT_PARTITIONS_PATH = path.join(__dirname, 'v2BenchmarkPartitions.json');

function allPairs(decks) {
    const pairs = [];
    for(let left = 0; left < decks.length; left++) {
        for(let right = left + 1; right < decks.length; right++) pairs.push([decks[left], decks[right]]);
    }
    return pairs;
}

function expandMatchups(partition) {
    return partition.matchups === 'all-pairs' ? allPairs(partition.decks) : partition.matchups;
}

function validatePartitions(config) {
    const errors = [];
    for(const name of ['training', 'holdout']) {
        const partition = config[name] || {};
        const missing = DECK_LABELS.filter((deck) => !partition.decks?.includes(deck));
        if(missing.length) errors.push(`${name} misses decks: ${missing.join(', ')}`);
        const matchups = expandMatchups(partition);
        if(!Array.isArray(matchups) || matchups.length !== allPairs(DECK_LABELS).length) {
            errors.push(`${name} must cover the full unordered deck league`);
        }
        if(!partition.rngSeeds?.length) errors.push(`${name} needs RNG seeds`);
        if(!partition.strategySeeds?.length) errors.push(`${name} needs strategy seeds`);
        if(!['fair', 'omniscient'].every((mode) => partition.informationModes?.includes(mode))) {
            errors.push(`${name} must cover fair and omniscient information`);
        }
    }
    const overlap = (config.training?.rngSeeds || []).filter((seed) => config.holdout?.rngSeeds?.includes(seed));
    if(overlap.length) errors.push(`training/holdout RNG overlap: ${overlap.join(', ')}`);
    const archetypeDecks = Object.keys(config.archetypes || {});
    const missingArchetypes = DECK_LABELS.filter((deck) => !archetypeDecks.includes(deck) || !config.archetypes[deck]?.length);
    if(missingArchetypes.length) errors.push(`missing archetype labels: ${missingArchetypes.join(', ')}`);
    return { valid: errors.length === 0, errors };
}

function loadPartitions(file = DEFAULT_PARTITIONS_PATH) {
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    const validation = validatePartitions(config);
    if(!validation.valid) throw new Error(validation.errors.join('; '));
    return config;
}

module.exports = { DEFAULT_PARTITIONS_PATH, allPairs, expandMatchups, loadPartitions, validatePartitions };
