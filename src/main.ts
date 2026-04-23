import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origin = process.env.THALOS_CORS_ORIGIN;
  app.enableCors({
    origin: origin ? origin.split(",").map((o) => o.trim()) : true,
    credentials: true,
  });
  app.setGlobalPrefix("v1");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Thalos API")
    .setDescription(
      "Acuerdos en Supabase, contactos, búsqueda de usuarios y proxy hacia Trustless Work.",
    )
    .setVersion("1.0")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT de la app (mismo JWT_SECRET que el frontend).",
      },
      "bearer",
    )
    .addApiKey(
      {
        type: "apiKey",
        name: "x-thalos-internal-secret",
        in: "header",
        description: "Secreto Next.js → Nest (relay interno Trustless).",
      },
      "thalos-internal",
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document, {
    jsonDocumentUrl: "docs-json",
    /** Sin esto, Swagger queda en `/docs` aunque el API use `setGlobalPrefix('v1')`. */
    useGlobalPrefix: true,
  });

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port);
}

bootstrap();
