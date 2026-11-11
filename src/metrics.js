const config = require('./config');
const os = require('os');
const si = require('systeminformation');

const requests = {
  total: 0,
  GET: 0,
  PUT: 0,
  POST: 0,
  DELETE: 0,
};

function requestTracker(req, res, next) {
  requests.total++;

  if (requests[req.method] !== undefined) {
    requests[req.method]++;
  }

  next();
}

const startTimeUnixNano = Date.now() * 1000000;
const latencyBounds = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
function createHistogram() {
  return {
    count: 0,
    sum: 0,
    bucketCounts: new Array(latencyBounds.length + 1).fill(0),
  };
}

function recordLatency(histogram, ms) {
  histogram.count++;
  histogram.sum += ms;
  let i = latencyBounds.findIndex((bound) => ms <= bound);
  if (i === -1) i = latencyBounds.length;
  histogram.bucketCounts[i]++;
}

function histogramValue(histogram) {
  return {
    startTimeUnixNano,
    count: histogram.count,
    sum: histogram.sum,
    bucketCounts: [...histogram.bucketCounts],
    explicitBounds: latencyBounds,
  };
}

const serviceLatency = createHistogram();
const pizzaCreationLatency = createHistogram();

function latencyTracker(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    recordLatency(serviceLatency, Number(process.hrtime.bigint() - start) / 1e6);
  });
  next();
}

function pizzaLatency(ms) {
  recordLatency(pizzaCreationLatency, ms);
}

const ACTIVE_USER_WINDOW_MS = 5 * 60 * 1000;
const activeUsers = new Map(); // userId -> last request time (ms)

function activeUserTracker(req, res, next) {
  if (req.user && req.user.id !== undefined) {
    activeUsers.set(req.user.id, Date.now());
  }
  next();
}

function getActiveUserCount() {
  const cutoff = Date.now() - ACTIVE_USER_WINDOW_MS;
  activeUsers.forEach((lastSeen, userId) => {
    if (lastSeen < cutoff) {
      activeUsers.delete(userId);
    }
  });
  return activeUsers.size;
}

const authAttempts = {
  success: 0,
  failure: 0,
};

function authSuccess() {
  authAttempts.success++;
}

function authFailure() {
  authAttempts.failure++;
}

const pizzaStats = {
  sold: 0,
  creationFailures: 0,
  revenue: 0,
};

function pizzaSold(items) {
  items.forEach((item) => {
    pizzaStats.sold++;
    pizzaStats.revenue += Number(item.price) || 0;
  });
}

function pizzaCreationFailure() {
  pizzaStats.creationFailures++;
}


async function getCpuUsagePercentage() {
  const cpu = await si.currentLoad();
  return Number(cpu.currentLoad.toFixed(2));
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;
  return memoryUsage.toFixed(2);
}

function createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes) {
  attributes = { ...attributes, source: config.metrics.source };

  const metric = {
    name: metricName,
    unit: metricUnit,
    [metricType]: {
      dataPoints: [
        {
          ...(metricType === 'histogram' ? metricValue : { [valueType]: metricValue }),
          timeUnixNano: Date.now() * 1000000,
          attributes: [],
        },
      ],
    },
  };

  Object.keys(attributes).forEach((key) => {
    metric[metricType].dataPoints[0].attributes.push({
      key: key,
      value: { stringValue: attributes[key] },
    });
  });

  if (metricType === 'sum') {
    metric[metricType].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric[metricType].isMonotonic = true;
  }

  if (metricType === 'histogram') {
    metric[metricType].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
  }

  return metric;
}

async function sendMetricsPeriodically(period) {
    //const timer = in case I need a timer
    setInterval(async () => {
      try {
        const cpu = await getCpuUsagePercentage();
        const metrics = [];
        metrics.push(createMetric('cpu_percent', cpu, '%', 'gauge', 'asDouble', {}));
        metrics.push(createMetric('memory_percent', getMemoryUsagePercentage(), '%', 'gauge', 'asDouble', {}));
        metrics.push(createMetric('active_users', getActiveUserCount(), '1', 'gauge', 'asInt', {}));
        Object.keys(requests).forEach((method) => {
          metrics.push(createMetric('requests', requests[method], '1', 'sum', 'asInt', { method }));
        });
        metrics.push(createMetric('authentication_success', authAttempts.success, '1', 'sum', 'asInt', {}));
        metrics.push(createMetric('authentication_failure', authAttempts.failure, '1', 'sum', 'asInt', {}));
        metrics.push(createMetric('pizzas_sold', pizzaStats.sold, '1', 'sum', 'asInt', {}));
        metrics.push(createMetric('pizza_creation_failures', pizzaStats.creationFailures, '1', 'sum', 'asInt', {}));
        metrics.push(createMetric('revenue', pizzaStats.revenue, '1', 'sum', 'asDouble', {}));
        metrics.push(createMetric('service_latency_millisecond', histogramValue(serviceLatency), 'ms', 'histogram', null, {}));
        metrics.push(createMetric('pizza_creation_latency_millisecond', histogramValue(pizzaCreationLatency), 'ms', 'histogram', null, {}));

        sendMetricToGrafana(metrics);
      } catch (error) {
        console.log('Error sending metrics', error);
      }
  }, period);
}


function sendMetricToGrafana(metrics) {
  const body = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics,
          },
        ],
      },
    ],
  };

  fetch(`${config.metrics.endpointUrl}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`, 'Content-Type': 'application/json' },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP status: ${response.status}`);
      }
    })
    .catch((error) => {
      console.error('Error pushing metrics:', error);
    });
}

module.exports = {
  sendMetricsPeriodically,
  requestTracker,
  latencyTracker,
  pizzaLatency,
  activeUserTracker,
  authSuccess,
  authFailure,
  pizzaSold,
  pizzaCreationFailure,
};