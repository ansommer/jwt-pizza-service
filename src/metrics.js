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
          [valueType]: metricValue,
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

  return metric;
}

async function sendMetricsPeriodically(period) {
    //const timer = 
    setInterval(async () => {
      try {
        const cpu = await getCpuUsagePercentage();
        const metrics = [];
        metrics.push(createMetric('cpu_percent', cpu, '%', 'gauge', 'asDouble', {}));
        metrics.push(createMetric('memory_percent', getMemoryUsagePercentage(), '%', 'gauge', 'asDouble', {}));
        Object.keys(requests).forEach((method) => {
          metrics.push(createMetric('requests', requests[method], '1', 'sum', 'asInt', { method }));
        });
        metrics.push(createMetric('authentication_success', authAttempts.success, '1', 'sum', 'asInt', {}));
        metrics.push(createMetric('authentication_failure', authAttempts.failure, '1', 'sum', 'asInt', {}));
        
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
  authSuccess,
  authFailure
};