const fs = require('fs');
const csv = require('csv-parser');

let shapesMap = {};

function loadShapes() {
    return new Promise((resolve, reject) => {
        fs.createReadStream('./gtfs/shapes.txt')
            .pipe(csv())
            .on('data', (row) => {
                const id = row.shape_id;

                if (!shapesMap[id]) {
                    shapesMap[id] = [];
                }

                shapesMap[id].push({
                    lat: parseFloat(row.shape_pt_lat),
                    lon: parseFloat(row.shape_pt_lon),
                    seq: parseInt(row.shape_pt_sequence),
                });
            })
            .on('end',  () => {
                Object.keys(shapesMap).forEach((id) => {
                    shapesMap[id].sort((a, b) => a.seq - b.seq);
                });

                console.log(`loaded ${Object.keys(shapesMap).length} shapes`);
                resolve();
            })
            .on('error', reject);
    })
}

function getShape(id) {
    return shapesMap[id];
}

module.exports = {
    loadShapes,
    getShape,
}