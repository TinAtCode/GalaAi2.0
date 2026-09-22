import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CustomersModule } from './customers/customers.module';
import { PropertiesModule } from './properties/properties.module';
import { ProjectsModule } from './projects/projects.module';
import { RolesModule } from './roles/roles.module';
import { PermissionsListModule } from './permissions/permissions.module';
import { ArticlesModule } from './articles/articles.module';
import { ServicesCatalogModule } from './services-catalog/services-catalog.module';
import { CompanyModule } from './company/company.module';
import { CalculationsModule } from './calculations/calculations.module';
import { QuotesModule } from './quotes/quotes.module';
import { OrdersModule } from './orders/orders.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { MachinesModule } from './machines/machines.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { EmployeesModule } from './employees/employees.module';
import { TimeEntriesModule } from './time-entries/time-entries.module';
import { PostCalculationModule } from './post-calculation/post-calculation.module';
import { DocumentsModule } from './documents/documents.module';
import { DataGuardianModule } from './data-guardian/data-guardian.module';
import { AiGatewayModule } from './ai-gateway/ai-gateway.module';
import { MaterialUsageModule } from './material-usage/material-usage.module';
import { OcrModule } from './ocr/ocr.module';
import { HealthModule } from './health/health.module';
import { LOGIN_ACCOUNT_THROTTLER } from './auth/login-throttle';

@Module({
  imports: [
    // Globales Rate-Limiting (Punkt 38: "sichere API"). 100 Anfragen/Minute
    // pro IP als vernünftiger Standard; der Login bekommt zusätzlich eigene,
    // engere Grenzen gegen Brute-Force (siehe auth/login-throttle.ts).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100 }, LOGIN_ACCOUNT_THROTTLER]),
    PrismaModule,
    AuthModule,
    CustomersModule,
    PropertiesModule,
    ProjectsModule,
    RolesModule,
    PermissionsListModule,
    ArticlesModule,
    ServicesCatalogModule,
    CompanyModule,
    CalculationsModule,
    QuotesModule,
    OrdersModule,
    SuppliersModule,
    MachinesModule,
    AppointmentsModule,
    EmployeesModule,
    TimeEntriesModule,
    PostCalculationModule,
    DocumentsModule,
    DataGuardianModule,
    AiGatewayModule,
    MaterialUsageModule,
    OcrModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
