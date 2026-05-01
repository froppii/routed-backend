const express = require('express');
const axios = require('axios');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const cors = require('cors');

const { loadStops, getStopById, getAllStops } = require('./gtfs/stops');
const { loadShapes, getShape } = require('./gtfs/shapes');
const { loadTrips, getShapeId } = require('./gtfs/trips');

async function start() {
    await loadStops();
    await loadTrips();
    await loadShapes();

    app.listen(PORT, () => {
        console.log(`backend running at http://localhost:${PORT}`);
    });
}

const app = express();
app.use(cors());

const PORT = 3001;

// MTA subway feeds
const FEEDS = [
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz",
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l",
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si",
];

let cache = {
    data: null,
    lastUpdated: 0,
};

const CACHE_DURATION = 15000;

// fetch and merge all feeds
async function fetchAllFeeds() {
    const responses = await Promise.all(
        FEEDS.map((url) =>
            axios.get(url, { responseType: 'arraybuffer' })
        )
    );

    const decodedFeeds = responses.map((res) =>
    GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
        new Uint8Array(res.data)
        )
    );

    return decodedFeeds.flatMap((feed) => feed.entity);
}

async function getFeedData() {
    const now = Date.now();
    if (cache.data && now - cache.lastUpdated < CACHE_DURATION) {
        return cache.data;
    }

    try {
        const merged = await fetchAllFeeds();

        cache = {
            data: merged,
            lastUpdated: now,
        };

        return merged;
    } catch (err) {
        console.error('Error fetching feeds:', err.message);

        if (cache.data) return cache.data;

        throw err;
    }
}

// convert unix to minutes
function getMinutesAway(timestamp) {
    const now = Math.floor(Date.now() / 1000);
    return Math.round((timestamp - now) / 60);
}

function resolveStop(stopId) {
    let stop = getStopById(stopId);

    if (!stop) {
        const base = stopId.slice(0, -1);
        stop = getStopById(base);
    }

    return stop;
}

function getArrivalsByStop(entities, stopId) {
    const arrivals = [];

    entities.forEach((entity) => {
        const trip = entity.tripUpdate;
        if (!trip) return;

        trip.stopTimeUpdate?.forEach((stop) => {
            if (stop.stopId === stopId && stop.arrival?.time) {
                arrivals.push({    
                    route: trip.trip.routeId,
                    tripId: trip.trip.tripId,
                    arrival: stop.arrival.time,
                });
            }
        });
    });

    return arrivals.sort((a, b) => a.arrival - b.arrival);
}

function getRoutesSummary(entities) {
    const routes = {};

    entities.forEach((entity) => {
        const trip = entity.tripUpdate;
        if (!trip) return;

        const routeId = trip.trip.routeId;

        if (!routes[routeId]) {
            routes[routeId] = {
                route: routeId,
                trips: 0,
            };
        }

        routes[routeId].trips++;
    });

    return Object.values(routes);
}

// ---- ROUTES ----

// health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        lastUpdated: cache.lastUpdated,
    });
});

// all routes summary
app.get('/routes', async (req, res) => {
    try {
        const data = await getFeedData();
        const routes = getRoutesSummary(data);
        res.json(routes);
    } catch {
        res.status(500).json({ error: 'failed to fetch routes' });
    }
});

app.get('/stops', (req, res) => {
    res.json(getAllStops());
});

// get stop arrivals
app.get('/stop/:stopId', async (req, res) => {
    const { stopId } = req.params;

    try {
        const data = await getFeedData();
        const arrivals = getArrivalsByStop(data, stopId);

        const stopInfo = getStopById(stopId);

        res.json({
            stop: stopInfo || { id: stopId, name: 'unknown' },
            arrivals,
        });
    } catch {
        res.status(500).json({ error: 'failed to fetch stop data' });
    }
});

app.get('/vehicles', async (req, res) => {
    try {
        const data = await getFeedData();
        const vehicles = [];

        data.forEach((entity) => {
            const trip = entity.tripUpdate;
            if (!trip) return;

            const updates = trip.stopTimeUpdate;
            if (!updates || updates.length < 2) return;

            const tripId = trip.trip.tripId;
            const shapeId = getShapeId(tripId);
            const shape = getShape(shapeId);

            if (!shape) return;

            for (let i = 0; i < updates.length - 1; i++) {
                const current = updates[i];
                const next = updates[i + 1];

                if (!current.arrival?.time || !next.arrival?.time) continue;

                const now = Date.now() / 1000;

                if (now >= current.arrival.time && now <= next.arrival.time) {
                    const progress = (now - current.arrival.time) / (next.arrival.time - current.arrival.time);
                    
                    const pos = interpolateAlongShape(shape, progress);

                    if (pos) {
                        vehicles.push({
                            route: trip.trip.routeId,
                            tripId,
                            lat: pos.lat,
                            lon: pos.lon,
                        });
                    }

                    break;
                }
            }
        });

        res.json(vehicles);
    } catch (err) {
        console.error(err);
        res.status(500).send('error');
    }
});

// get raw merged data
app.get('/debug', async (req, res) => {
    try {
        const data = await getFeedData();
        res.json(data.slice(0, 50));
    } catch {
        res.status(500).send('error');
    }
});

function interpolateAlongShape(shape, progress) {
    if (!shape || shape.length === 0) return null;

    const totalPoint = shape.length;
    const index = progress * (totalPoint - 1);

    const i = Math.floor(index);
    const t = index - i;

    const p1 = shape[i];
    const p2 = shape[i + 1] || p1;

    return {
        lat: p1.lat + ( p2.lat - p1.lat) * t,
        lon: p1.lon + ( p2.lon - p1.lon) * t,
    };
}

async function startServer() {
    await loadStops();
    await loadTrips();
    await loadShapes();
    
    app.listen(PORT, () => {
        console.log(`routed backend running on https://localhost:${PORT}`);
    });
}

startServer();