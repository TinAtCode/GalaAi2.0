import { NotFoundException } from '@nestjs/common';
import { DocumentsService } from '../src/documents/documents.service';

function createPrismaMock() {
  const projects = [{ id: 'proj-a', property: { customer: { companyId: 'company-a' } } }];
  const documents = [
    { id: 'doc-a', companyId: 'company-a', projectId: 'proj-a', fileName: 'rechnung.pdf' },
    { id: 'doc-b', companyId: 'company-b', projectId: null, fileName: 'fremd.pdf' },
  ];

  return {
    project: {
      findFirst: jest.fn(({ where }: any) => {
        if (where.id !== 'proj-a') return Promise.resolve(null);
        const requiredCompanyId = where.property?.customer?.companyId;
        if (requiredCompanyId && requiredCompanyId !== 'company-a') return Promise.resolve(null);
        return Promise.resolve(projects[0]);
      }),
    },
    document: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(documents.find((d) => d.id === where.id && d.companyId === where.companyId) ?? null),
      ),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          documents.filter((d) =>
            where.companyId ? d.companyId === where.companyId : d.projectId === where.projectId,
          ),
        ),
      ),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'new-doc', ...data })),
    },
  };
}

const storageMock = {
  name: 'mock',
  save: jest.fn(() => Promise.resolve({ storagePath: 'mock-path' })),
  read: jest.fn(() => Promise.resolve(Buffer.from('mock content'))),
};

describe('DocumentsService – Mandantentrennung', () => {
  it('findOne wirft NotFoundException bei fremder Firma', async () => {
    const prisma = createPrismaMock();
    const service = new DocumentsService(prisma as any, storageMock as any);

    await expect(service.findOne('company-a', 'doc-b')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findAllForCompany liefert nur eigene Dokumente', async () => {
    const prisma = createPrismaMock();
    const service = new DocumentsService(prisma as any, storageMock as any);

    const result = await service.findAllForCompany('company-a');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('doc-a');
  });

  it('create lehnt eine fremde projectId ab', async () => {
    const prisma = createPrismaMock();
    const service = new DocumentsService(prisma as any, storageMock as any);

    await expect(
      service.create('company-b', 'user-x', {
        fileName: 'test.pdf',
        storagePath: '/x',
        projectId: 'proj-a', // gehört zu company-a
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('create funktioniert innerhalb derselben Firma', async () => {
    const prisma = createPrismaMock();
    const service = new DocumentsService(prisma as any, storageMock as any);

    const doc = await service.create('company-a', 'user-x', {
      fileName: 'aufmass.pdf',
      storagePath: '/uploads/aufmass.pdf',
      projectId: 'proj-a',
    });
    expect(doc.id).toBe('new-doc');
    expect(doc.uploadedByUserId).toBe('user-x');
  });
});

describe('DocumentsService – Upload/Download', () => {
  it('upload speichert die Datei im Storage UND registriert die Metadaten', async () => {
    const prisma = createPrismaMock();
    const service = new DocumentsService(prisma as any, storageMock as any);

    const doc = await service.upload(
      'company-a',
      'user-x',
      { originalname: 'lieferschein.pdf', buffer: Buffer.from('Inhalt') },
      'proj-a',
      'delivery_note',
    );

    expect(storageMock.save).toHaveBeenCalledWith('company-a', 'lieferschein.pdf', expect.any(Buffer));
    expect(doc.storagePath).toBe('mock-path');
    expect(doc.documentType).toBe('delivery_note');
  });

  it('upload lehnt eine fremde projectId ab, BEVOR etwas gespeichert wird', async () => {
    const prisma = createPrismaMock();
    storageMock.save.mockClear();
    const service = new DocumentsService(prisma as any, storageMock as any);

    await expect(
      service.upload('company-b', 'user-x', { originalname: 'x.pdf', buffer: Buffer.from('x') }, 'proj-a'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storageMock.save).not.toHaveBeenCalled();
  });

  it('getFileContent liefert Dateiinhalt und Dateiname aus Metadaten + Storage zusammen', async () => {
    const prisma = createPrismaMock();
    const service = new DocumentsService(prisma as any, storageMock as any);

    const result = await service.getFileContent('company-a', 'doc-a');
    expect(result.fileName).toBe('rechnung.pdf');
    expect(result.buffer.toString()).toBe('mock content');
  });

  it('getFileContent lehnt ein Dokument einer fremden Firma ab', async () => {
    const prisma = createPrismaMock();
    const service = new DocumentsService(prisma as any, storageMock as any);

    await expect(service.getFileContent('company-a', 'doc-b')).rejects.toBeInstanceOf(NotFoundException);
  });
});
