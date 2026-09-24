import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { lockFor } from '../common/advisory-lock';
import { setupCompany } from '../cli/setup-company';
import { FirstSetupDto } from './setup.dto';

const setupCode = () => process.env.SETUP_CODE?.trim() || '';

function sameCode(given: string, expected: string) {
  const a = Buffer.from(given.trim().toUpperCase());
  const b = Buffer.from(expected.toUpperCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

// Ersteinrichtung in der App (Mini-Vollversion auf einem Rechner): Solange es
// keinen Nutzer gibt und SETUP_CODE gesetzt ist, legt man Firma und ersten
// Administrator im Browser an. Der Code steht nur im Startskript bzw. in der
// .env der Installation – wer im selben Netz die Seite zuerst öffnet, kann
// die Firma ohne ihn nicht übernehmen. Danach ist die Einrichtung gesperrt.
@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);
  constructor(private prisma: PrismaService) {}

  // ohne Mandantenfilter: die Frage ist gerade, ob es überhaupt Nutzer gibt
  private async hasUsers(client: { $queryRaw: PrismaService['$queryRaw'] } = this.prisma) {
    const rows = await client.$queryRaw<
      { exists: boolean }[]
    >`SELECT EXISTS (SELECT 1 FROM "User") AS "exists"`;
    return rows[0]?.exists ?? false;
  }

  async status() {
    return { needed: Boolean(setupCode()) && !(await this.hasUsers()) };
  }

  async setup(dto: FirstSetupDto) {
    const code = setupCode();
    if (!code) throw new NotFoundException();
    if (!sameCode(dto.code, code)) throw new ForbiddenException('Der Einrichtungscode stimmt nicht.');
    try {
      const result = await setupCompany(this.prisma, dto, async (tx) => {
        await lockFor(tx, 'setup', 'first-company');
        if (await this.hasUsers(tx)) throw new ForbiddenException('Die Einrichtung ist schon abgeschlossen.');
      });
      this.logger.log({ msg: 'Ersteinrichtung abgeschlossen', companyId: result.companyId });
      return { email: result.email };
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : 'Einrichtung fehlgeschlagen.');
    }
  }
}
