import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { withTotalCount } from '../common/pagination';
import { FinanceService } from './finance.service';
import {
  AssignCategoryDto,
  BusinessContractDto,
  CategoryNameDto,
  CategoryRuleDto,
  ListTransactionsDto,
  UpsertRecurringDto,
} from './finance.dto';
import { CategoriesService } from './categories.service';
import { RecurringService } from './recurring.service';
import { ContractsService } from './contracts.service';

// Nur Geschäftsführung und Buchhaltung (Recht finance.read)
@Controller('finance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.FINANCE_READ)
export class FinanceController {
  constructor(
    private financeService: FinanceService,
    private categories: CategoriesService,
    private recurring: RecurringService,
    private contracts: ContractsService,
  ) {}

  // Liquiditätsvorschau der nächsten 13 Wochen
  @Get('forecast')
  forecast(@CurrentUser() user: AuthenticatedUser) {
    return this.recurring.forecast(user.companyId);
  }

  @Get('overview')
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.financeService.overview(user.companyId);
  }

  @Get('transactions')
  async transactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTransactionsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return withTotalCount(res, await this.financeService.transactions(user.companyId, query));
  }

  // Kategorie von Hand zuordnen (null = ohne); optional als Regel merken
  @Patch('transactions/:id')
  assign(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AssignCategoryDto) {
    return this.categories.assign(user.companyId, id, dto.categoryId, dto.createRule ?? false);
  }

  // Abbuchungen ohne Kategorie erneut nach Regeln und Gelerntem zuordnen
  @Post('transactions/categorize')
  categorize(@CurrentUser() user: AuthenticatedUser) {
    return this.categories.categorizeOpen(user.companyId);
  }

  @Get('categories')
  listCategories(@CurrentUser() user: AuthenticatedUser) {
    return this.categories.list(user.companyId);
  }

  @Post('categories')
  createCategory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CategoryNameDto) {
    return this.categories.create(user.companyId, dto.name);
  }

  @Patch('categories/:id')
  renameCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CategoryNameDto,
  ) {
    return this.categories.rename(user.companyId, id, dto.name);
  }

  @Delete('categories/:id')
  removeCategory(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.categories.remove(user.companyId, id);
  }

  @Post('categories/:id/rules')
  addRule(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CategoryRuleDto) {
    return this.categories.addRule(user.companyId, id, dto.pattern, dto.field ?? 'any');
  }

  @Delete('rules/:id')
  removeRule(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.categories.removeRule(user.companyId, id);
  }

  @Get('recurring')
  listRecurring(@CurrentUser() user: AuthenticatedUser) {
    return this.recurring.list(user.companyId);
  }

  @Get('recurring/suggestions')
  recurringSuggestions(@CurrentUser() user: AuthenticatedUser) {
    return this.recurring.suggestions(user.companyId);
  }

  @Post('recurring')
  createRecurring(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertRecurringDto) {
    return this.recurring.create(user.companyId, dto);
  }

  @Patch('recurring/:id')
  updateRecurring(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertRecurringDto,
  ) {
    return this.recurring.update(user.companyId, id, dto);
  }

  @Delete('recurring/:id')
  removeRecurring(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.recurring.remove(user.companyId, id);
  }

  // Versicherungen und Verträge mit Laufzeit und Kündigungsfrist
  @Get('contracts')
  listContracts(@CurrentUser() user: AuthenticatedUser) {
    return this.contracts.list(user.companyId);
  }

  @Post('contracts')
  createContract(@CurrentUser() user: AuthenticatedUser, @Body() dto: BusinessContractDto) {
    return this.contracts.create(user, dto);
  }

  @Put('contracts/:id')
  updateContract(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BusinessContractDto,
  ) {
    return this.contracts.update(user, id, dto);
  }

  @Delete('contracts/:id')
  removeContract(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.remove(user, id);
  }

  // Jahresüberblick: ?year=2026 (ohne Angabe das laufende Jahr)
  @Get('year')
  year(@CurrentUser() user: AuthenticatedUser, @Query('year') year?: string) {
    const value = year ? Number(year) : new Date().getFullYear();
    if (!Number.isInteger(value) || value < 2000 || value > 2100) {
      throw new BadRequestException('Jahr als Zahl angeben, z.B. year=2026.');
    }
    return this.recurring.year(user.companyId, value);
  }
}
