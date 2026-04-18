export async function startOpenTelemetry() {
  const enabled = (process.env.OTEL_ENABLED ?? "").toLowerCase() === "true";
  if (!enabled) {
    return;
  }

  try {
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier);"
    ) as (specifier: string) => Promise<any>;

    const [
      api,
      exporterModule,
      instrumentationsModule,
      resourcesModule,
      sdkModule,
      semconvModule
    ] = await Promise.all([
      dynamicImport("@opentelemetry/api"),
      dynamicImport("@opentelemetry/exporter-trace-otlp-http"),
      dynamicImport("@opentelemetry/auto-instrumentations-node"),
      dynamicImport("@opentelemetry/resources"),
      dynamicImport("@opentelemetry/sdk-node"),
      dynamicImport("@opentelemetry/semantic-conventions")
    ]);

    api.diag.setLogger(new api.DiagConsoleLogger(), api.DiagLogLevel.WARN);

    const exporterUrl =
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
      "http://localhost:4318/v1/traces";

    const sdk = new sdkModule.NodeSDK({
      resource: new resourcesModule.Resource({
        [semconvModule.SEMRESATTRS_SERVICE_NAME]:
          process.env.OTEL_SERVICE_NAME ?? "family-app-server",
        [semconvModule.SEMRESATTRS_SERVICE_VERSION]:
          process.env.npm_package_version ?? "0.0.0"
      }),
      traceExporter: new exporterModule.OTLPTraceExporter({ url: exporterUrl }),
      instrumentations: [
        instrumentationsModule.getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false }
        })
      ]
    });

    await sdk.start();

    const shutdown = async () => {
      try {
        await sdk.shutdown();
      } catch {
        // ignore
      }
    };

    process.once("SIGTERM", () => void shutdown());
    process.once("SIGINT", () => void shutdown());
  } catch (error) {
    console.warn("OpenTelemetry startup skipped:", error);
  }
}
