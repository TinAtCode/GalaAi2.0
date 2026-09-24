import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AiProviderConfig, AiProviderKind, Prisma } from '@prisma/client';
import { changedFields, writeAudit } from '../common/audit';
import { openSecret, sealSecret } from '../common/secret-box';
import { PrismaService } from '../prisma/prisma.service';
import { AiCompletionResult, AiImage, AiProvider, AiProviderError } from './ai-provider.interface';
import { filterContext, MAX_CONTEXT_BYTES } from './context-filter';
import { CompleteDto } from './dto/complete.dto';
import { AssignTaskDto, CreateAiProviderDto, UpdateAiProviderDto } from './dto/provider.dto';
import { AI_CAPABILITIES, AI_TASKS, AiCapability, findTask } from './tasks';
import { AgentProvider, AnthropicProvider, OpenAiCompatibleProvider } from './providers/configured-providers';
import { assertProviderUrl } from './providers/http';
import { NoopAiProvider } from './providers/noop-provider';

export interface Caller {
  companyId: string;
  userId: string;
  permissions: string[];
}

// was nach außen geht: nie der Schlüssel, nur ob einer hinterlegt ist
function publicConfig(config: AiProviderConfig) {
  const { apiKeyEncrypted, ...rest } = config;
  return { ...rest, hasApiKey: Boolean(apiKeyEncrypted) };
}

// Schlägt fehl, wenn SECRET_KEY (bzw. JWT_SECRET) seit dem Speichern geändert wurde
function decryptKey(sealed: string) {
  try {
    return openSecret(sealed);
  } catch {
    throw new BadRequestException(
      'Der gespeicherte API-Schlüssel lässt sich nicht entschlüsseln (SECRET_KEY geändert?) – bitte neu eingeben.',
    );
  }
}

export function providerFor(config: AiProviderConfig, model?: string | null): AiProvider {
  const settings = {
    name: config.name,
    baseUrl: config.baseUrl,
    model: model || config.model,
    apiKey: config.apiKeyEncrypted ? decryptKey(config.apiKeyEncrypted) : null,
    timeoutSeconds: config.timeoutSeconds,
    maxTokens: config.maxTokens,
    systemPrompt: config.systemPrompt,
  };
  switch (config.kind) {
    case AiProviderKind.openai_compatible:
      return new OpenAiCompatibleProvider(settings);
    case AiProviderKind.anthropic:
      return new AnthropicProvider(settings);
    case AiProviderKind.agent:
      return new AgentProvider(settings);
  }
}

@Injectable()
export class AiGatewayService {
  private readonly none = new NoopAiProvider();

  constructor(private prisma: PrismaService) {}

  // ── Anbieter verwalten (Einstellungen → KI-Anbieter) ──────────────────────

  async list(companyId: string) {
    const configs = await this.prisma.aiProviderConfig.findMany({
      where: { companyId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return configs.map(publicConfig);
  }

  private async find(companyId: string, id: string) {
    const config = await this.prisma.aiProviderConfig.findFirst({ where: { id, companyId } });
    if (!config) throw new NotFoundException('KI-Anbieter nicht gefunden.');
    return config;
  }

  // Adresse prüfen (Format, gesperrte Netze); Anthropic ohne Adresse = offizielle API
  private async checkedUrl(kind: AiProviderKind, baseUrl: string | undefined) {
    const url = baseUrl?.trim() || (kind === AiProviderKind.anthropic ? 'https://api.anthropic.com' : '');
    if (!url) throw new BadRequestException('Bitte die Adresse des Anbieters angeben.');
    try {
      await assertProviderUrl(url);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return url;
  }

  private needsModel(kind: AiProviderKind, model: string | null | undefined) {
    if (kind !== AiProviderKind.agent && !model?.trim()) {
      throw new BadRequestException('Bitte das Modell angeben (z.B. llama3.1 oder claude-…).');
    }
  }

  async create(caller: Caller, dto: CreateAiProviderDto) {
    const baseUrl = await this.checkedUrl(dto.kind, dto.baseUrl);
    this.needsModel(dto.kind, dto.model);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, caller.companyId);
      const created = await tx.aiProviderConfig.create({
        data: {
          companyId: caller.companyId,
          name: dto.name.trim(),
          kind: dto.kind,
          baseUrl,
          model: dto.model?.trim() || null,
          apiKeyEncrypted: dto.apiKey ? sealSecret(dto.apiKey.trim()) : null,
          enabled: dto.enabled ?? true,
          isDefault: dto.isDefault ?? false,
          timeoutSeconds: dto.timeoutSeconds ?? 60,
          maxTokens: dto.maxTokens ?? 1024,
          systemPrompt: dto.systemPrompt?.trim() || null,
          capabilities: dto.capabilities ?? ['text'],
        },
      });
      const { hasApiKey, ...logged } = publicConfig(created);
      await writeAudit(tx, {
        companyId: caller.companyId,
        userId: caller.userId,
        action: 'ai_provider_created',
        entity: 'AiProviderConfig',
        entityId: created.id,
        newData: {
          ...logged,
          hasApiKey,
          createdAt: undefined,
          updatedAt: undefined,
        } as Prisma.InputJsonValue,
      });
      return publicConfig(created);
    });
  }

  async update(caller: Caller, id: string, dto: UpdateAiProviderDto) {
    const existing = await this.find(caller.companyId, id);
    const kind = dto.kind ?? existing.kind;
    const baseUrl =
      dto.baseUrl !== undefined || dto.kind !== undefined
        ? await this.checkedUrl(kind, dto.baseUrl ?? existing.baseUrl)
        : existing.baseUrl;
    const model = dto.model !== undefined ? dto.model.trim() || null : existing.model;
    this.needsModel(kind, model);
    const patch = {
      name: dto.name?.trim(),
      kind: dto.kind,
      baseUrl,
      model,
      enabled: dto.enabled,
      isDefault: dto.isDefault,
      timeoutSeconds: dto.timeoutSeconds,
      maxTokens: dto.maxTokens,
      systemPrompt: dto.systemPrompt !== undefined ? dto.systemPrompt.trim() || null : undefined,
      capabilities: dto.capabilities,
    };
    const apiKeyEncrypted = dto.clearApiKey ? null : dto.apiKey ? sealSecret(dto.apiKey.trim()) : undefined;
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, caller.companyId);
      const updated = await tx.aiProviderConfig.update({
        where: { id },
        data: { ...patch, apiKeyEncrypted },
      });
      const { oldData, newData } = changedFields(existing, patch);
      if (apiKeyEncrypted !== undefined) {
        oldData.apiKey = existing.apiKeyEncrypted ? 'hinterlegt' : 'keiner';
        newData.apiKey = apiKeyEncrypted ? 'neu hinterlegt' : 'gelöscht';
      }
      await writeAudit(tx, {
        companyId: caller.companyId,
        userId: caller.userId,
        action: 'ai_provider_updated',
        entity: 'AiProviderConfig',
        entityId: id,
        oldData,
        newData,
      });
      return publicConfig(updated);
    });
  }

  async remove(caller: Caller, id: string) {
    const existing = await this.find(caller.companyId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.aiProviderConfig.deleteMany({ where: { id, companyId: caller.companyId } });
      await writeAudit(tx, {
        companyId: caller.companyId,
        userId: caller.userId,
        action: 'ai_provider_deleted',
        entity: 'AiProviderConfig',
        entityId: id,
        oldData: { name: existing.name, kind: existing.kind, baseUrl: existing.baseUrl },
      });
    });
    return { deleted: true };
  }

  private clearDefault(tx: Prisma.TransactionClient, companyId: string) {
    return tx.aiProviderConfig.updateMany({
      where: { companyId, isDefault: true },
      data: { isDefault: false },
    });
  }

  // Verbindung prüfen: kurze Frage, Antwort und Dauer zurück (auch Fehler als Ergebnis)
  async test(caller: Caller, id: string) {
    const config = await this.find(caller.companyId, id);
    const started = Date.now();
    try {
      const provider = providerFor(config);
      const result = await this.run(caller, provider, config, {
        prompt: 'Antworte nur mit dem Wort: OK',
        task: 'verbindungstest',
      });
      return {
        ok: true,
        text: result.text.slice(0, 500),
        model: result.model,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof HttpException
            ? (error.getResponse() as { message: string }).message
            : 'Unerwarteter Fehler beim Test.',
        durationMs: Date.now() - started,
      };
    }
  }

  // ── Nutzen ────────────────────────────────────────────────────────────────

  private async activeConfig(companyId: string, providerId?: string) {
    if (providerId) {
      const config = await this.find(companyId, providerId);
      if (!config.enabled) throw new BadRequestException('Dieser KI-Anbieter ist ausgeschaltet.');
      return config;
    }
    return this.prisma.aiProviderConfig.findFirst({ where: { companyId, enabled: true, isDefault: true } });
  }

  // Wer übernimmt die Aufgabe? Zugeordneter Anbieter (mit eigenem Modell),
  // sonst der Standard-Anbieter – jeweils nur, wenn er kann, was die Aufgabe braucht.
  private async resolve(companyId: string, task?: string, providerId?: string) {
    if (providerId) return { config: await this.activeConfig(companyId, providerId), model: null };
    const needs: AiCapability = findTask(task)?.needs ?? 'text';
    if (task) {
      const assigned = await this.prisma.aiTaskAssignment.findFirst({
        where: { companyId, task },
        include: { provider: true },
      });
      if (assigned?.provider.enabled && assigned.provider.capabilities.includes(needs)) {
        return { config: assigned.provider, model: assigned.model };
      }
    }
    const fallback = await this.activeConfig(companyId);
    return { config: fallback?.capabilities.includes(needs) ? fallback : null, model: null };
  }

  async status(companyId: string) {
    const config = await this.activeConfig(companyId);
    // welche Aufgaben ein Anbieter übernehmen kann (für die Knöpfe in der App)
    const tasks: Record<string, boolean> = {};
    for (const task of AI_TASKS) tasks[task.key] = Boolean((await this.resolve(companyId, task.key)).config);
    return config
      ? { activeProvider: config.name, kind: config.kind, model: config.model, configured: true, tasks }
      : { activeProvider: this.none.name, kind: null, model: null, configured: false, tasks };
  }

  // Einziger Ort, an dem ein KI-Anbieter aufgerufen wird. Jeder Aufruf steht
  // im Audit-Log (Quelle "ai"), auch fehlgeschlagene.
  async complete(caller: Caller, dto: CompleteDto): Promise<AiCompletionResult> {
    const { config, model } = await this.resolve(caller.companyId, dto.task, dto.providerId);
    return this.run(caller, config ? providerFor(config, model) : this.none, config, dto, model);
  }

  // Für die Funktionen der App (Angebotstext, Zusammenfassung …): ohne
  // passenden Anbieter eine klare Meldung statt der Platzhalter-Antwort
  async runTask(
    caller: Caller,
    task: string,
    prompt: string,
    context?: Record<string, unknown>,
    images?: AiImage[],
  ) {
    const { config, model } = await this.resolve(caller.companyId, task);
    if (!config) {
      throw new BadRequestException(
        'Für diese Aufgabe ist kein KI-Anbieter eingerichtet (Einstellungen → KI-Anbieter).',
      );
    }
    return this.run(caller, providerFor(config, model), config, { prompt, task, context, images }, model);
  }

  // ── Aufgaben zuordnen (Einstellungen → KI-Anbieter) ───────────────────────

  async listTasks(companyId: string) {
    const assignments = await this.prisma.aiTaskAssignment.findMany({ where: { companyId } });
    return {
      capabilities: AI_CAPABILITIES,
      tasks: AI_TASKS.map((task) => {
        const a = assignments.find((x) => x.task === task.key);
        return { ...task, providerId: a?.providerId ?? null, model: a?.model ?? null };
      }),
    };
  }

  async assignTask(caller: Caller, taskKey: string, dto: AssignTaskDto) {
    const task = findTask(taskKey);
    if (!task) throw new NotFoundException('Unbekannte Aufgabe.');
    const { companyId } = caller;
    if (!dto.providerId) {
      await this.prisma.aiTaskAssignment.deleteMany({ where: { companyId, task: task.key } });
    } else {
      const provider = await this.find(companyId, dto.providerId);
      if (!provider.capabilities.includes(task.needs)) {
        const label = AI_CAPABILITIES.find((c) => c.key === task.needs)!.label;
        throw new BadRequestException(`„${provider.name}“ kann nicht: ${label}.`);
      }
      const model = dto.model?.trim() || null;
      await this.prisma.aiTaskAssignment.upsert({
        where: { companyId_task: { companyId, task: task.key } },
        create: { companyId, task: task.key, providerId: provider.id, model },
        update: { providerId: provider.id, model },
      });
    }
    await writeAudit(this.prisma, {
      companyId,
      userId: caller.userId,
      action: 'ai_task_assigned',
      entity: 'AiTaskAssignment',
      entityId: task.key,
      newData: { task: task.key, providerId: dto.providerId ?? null, model: dto.model ?? null },
    });
    return this.listTasks(companyId);
  }

  private async run(
    caller: Caller,
    provider: AiProvider,
    config: AiProviderConfig | null,
    dto: Pick<CompleteDto, 'prompt' | 'task' | 'context'> & { images?: AiImage[] },
    modelOverride?: string | null,
  ): Promise<AiCompletionResult> {
    const context = dto.context
      ? (filterContext(dto.context, caller.permissions) as Record<string, unknown>)
      : undefined;
    if (context && Buffer.byteLength(JSON.stringify(context)) > MAX_CONTEXT_BYTES) {
      throw new BadRequestException('Zu viele Daten für die KI (höchstens 100 KB).');
    }
    const started = Date.now();
    let result: AiCompletionResult | undefined;
    let failure: string | undefined;
    try {
      result = await provider.complete({
        prompt: dto.prompt,
        task: dto.task,
        context,
        caller: { companyId: caller.companyId, userId: caller.userId, permissions: caller.permissions },
        images: dto.images,
      });
      return result;
    } catch (error) {
      failure = error instanceof AiProviderError ? error.message : 'Unerwarteter Fehler beim KI-Anbieter.';
      throw new BadGatewayException(`KI-Anbieter „${provider.name}“: ${failure}`);
    } finally {
      await this.prisma.auditLog.create({
        data: {
          companyId: caller.companyId,
          userId: caller.userId,
          action: failure ? 'ai_completion_failed' : 'ai_completion',
          entity: 'AiGateway',
          entityId: config?.id,
          source: 'ai',
          newData: {
            task: dto.task ?? null,
            provider: provider.name,
            kind: config?.kind ?? 'none',
            model: result?.model ?? modelOverride ?? config?.model ?? null,
            prompt: dto.prompt.slice(0, 2000),
            contextKeys: context ? Object.keys(context) : [],
            // Bilder nur gezählt, nie gespeichert
            ...(dto.images?.length ? { images: dto.images.length } : {}),
            durationMs: Date.now() - started,
            ...(failure ? { error: failure } : { answerChars: result?.text.length ?? 0 }),
          },
        },
      });
    }
  }
}
