import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';

async function bootstrap() {
  const cfg = loadConfig();
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // GitHub webhook signatures are computed over the raw payload
 logger: cfg.NODE_ENV === 'production' ? ['log', 'warn', 'error'] : ['debug', 'log', 'warn', 'error'] });

  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle('prgd API')
    .setVersion('v1')
    .setDescription('The same API powers the console, CLI, Terraform, SDKs and AI agents. Canonical spec: packages/openapi/openapi.yaml')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  await app.listen(cfg.PORT);
  new Logger('api').log(`listening on :${cfg.PORT} — driver=${cfg.HYPERVISOR_DRIVER} region=${cfg.DEFAULT_REGION}`);
}

bootstrap();
