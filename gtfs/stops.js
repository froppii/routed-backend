const fs = require('fs');
const csv = require('csv-parser');
const { resolve } = require('dns');

let stopsMap = {};
let stopsList = [];

function loadStops() {
    return new Promise((resolve, reject) => {
        const results = [];

        fs.createReadStream('./gtfs/stops.txt')
        .pipe(csv())
        .on('data', (data) => {
            if (!data.stop_id || !data.stop_name) return;

            const stop = {
                id: data.stop_id,
                name: data.stop_name,
                lat: parseFloat(data.stop_lat),
                lon: parseFloat(data.stop_lon),
                parent: data.parent_station || null,
            };

            results.push(stop);
            stopsMap[stop.id] = stop;
        })
        .on('end', () => {
            stopsList = results;
            console.log(`loaded ${results.length} stops`);
            resolve();
        })
        .on('error', reject);
    });
}

function getStopById(id) {
    return stopsMap[id];
}

function getAllStops() {
    return stopsList;
}

module.exports = {
    loadStops,
    getStopById,
    getAllStops,
};