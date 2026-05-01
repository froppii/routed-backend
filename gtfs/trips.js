const fs = require('fs');
const csv = require('csv-parser');

let tripToShape = {};

function loadTrips() {
    return new Promise((resolve, reject) => {
        fs.createReadStream('./gtfs/trips.txt')
            .pipe(csv())
            .on('data', (row) => {
                tripToShape[row.trip_id] = row.shape_id;
            })
            .on('end', () => {
                console.log('loaded trips');
                resolve();
            })
            .on('error', reject);
    });
}

function getShapeId(tripId) {
    return tripToShape[tripId];
}

module.exports = {
    loadTrips,
    getShapeId,
};