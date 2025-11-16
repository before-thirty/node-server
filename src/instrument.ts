import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "https://32b6a72c5c039af228d66e9aeebac92d@o4510356004667392.ingest.us.sentry.io/4510367927304192",
  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
  // Add Express integration for request tracking
  integrations: [Sentry.expressIntegration()],
});
