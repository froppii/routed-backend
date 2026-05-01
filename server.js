const express = require('express');
const axios = require('axios');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const cors = require('cors');

const { loadStops, getStopById, getAllStops } = require('./gtfs/stops');

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

    return decodedFeeds = responses.flatMap((feed) => feed.entity);
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

function getArrivalsByStop(entities, stopId) {
    const arrival = [];

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

// get raw merged data
app.get('/debug', async (req, res) => {
    try {
        const data = await getFeedData();
        res.json(data.slice(0, 50));
    } catch {
        res.status(500).send('error');
    }
});

async function startServer() {
    await loadStops();
    
    app.listen(PORT, () => {
        console.log(`routed backend running on https://localhost:${PORT}`);
    });
}

startServer();