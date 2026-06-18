import { PrismaClient, UserRole, StepName } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando seed...');

  // Admin padrão
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@empresa.com.br' },
    update: {},
    create: {
      name: 'Administrador',
      email: 'admin@empresa.com.br',
      passwordHash: adminPassword,
      role: UserRole.ADMIN,
      active: true,
    },
  });
  console.log(`Usuário admin criado: ${admin.email}`);

  // Operador de exemplo
  const operatorPassword = await bcrypt.hash('operador123', 12);
  const operator = await prisma.user.upsert({
    where: { email: 'operador@empresa.com.br' },
    update: {},
    create: {
      name: 'Operador Financeiro',
      email: 'operador@empresa.com.br',
      passwordHash: operatorPassword,
      role: UserRole.OPERATOR,
      active: true,
    },
  });
  console.log(`Usuário operador criado: ${operator.email}`);

  // Regras de SLA
  const slaDefaults = [
    { stepName: StepName.PROPOSAL_ACCEPTED, businessDays: 0 },
    { stepName: StepName.CONTRACT_PREPARATION, businessDays: 1 },
    { stepName: StepName.CONTRACT_SIGNING, businessDays: 3 },
    { stepName: StepName.CONTRACT_REGISTRATION, businessDays: 1 },
    { stepName: StepName.CONTRACT_BILLING, businessDays: 1 },
  ];

  for (const sla of slaDefaults) {
    const existing = await prisma.slaRule.findFirst({ where: { stepName: sla.stepName, companyId: null } });
    if (existing) {
      await prisma.slaRule.update({ where: { id: existing.id }, data: { businessDays: sla.businessDays } });
    } else {
      await prisma.slaRule.create({ data: { ...sla, companyId: null } });
    }
  }
  console.log('Regras de SLA criadas/atualizadas.');

  // Dados mockados para desenvolvimento
  if (process.env.NODE_ENV !== 'production') {
    await seedMockData(admin.id, operator.id);
  }

  console.log('Seed concluído com sucesso!');
}

async function seedMockData(adminId: string, operatorId: string) {
  console.log('Criando dados mockados para desenvolvimento...');

  const customers = [
    { name: 'Empresa Alpha Ltda', document: '12.345.678/0001-90', email: 'contato@alpha.com.br', phone: '(11) 3456-7890' },
    { name: 'Beta Serviços S.A.', document: '98.765.432/0001-10', email: 'financeiro@beta.com.br', phone: '(21) 2345-6789' },
    { name: 'Gamma Tecnologia Ltda', document: '11.222.333/0001-44', email: 'admin@gamma.com.br', phone: '(31) 3456-7891' },
    { name: 'Delta Consultoria ME', document: '55.666.777/0001-55', email: 'delta@delta.com.br', phone: '(41) 3456-7892' },
    { name: 'Epsilon Digital Ltda', document: '99.888.777/0001-66', email: 'ep@epsilon.com.br', phone: '(51) 3456-7893' },
  ];

  const deals = [
    { title: 'Contrato de Serviços Anuais', value: 48000.00, daysAgo: 5 },
    { title: 'Projeto de Implementação ERP', value: 120000.00, daysAgo: 10 },
    { title: 'Suporte Técnico Mensal', value: 3600.00, daysAgo: 2 },
    { title: 'Licenciamento de Software', value: 24000.00, daysAgo: 15 },
    { title: 'Consultoria Estratégica', value: 75000.00, daysAgo: 20 },
  ];

  const stepOrder = [
    StepName.PROPOSAL_ACCEPTED,
    StepName.CONTRACT_PREPARATION,
    StepName.CONTRACT_SIGNING,
    StepName.CONTRACT_REGISTRATION,
    StepName.CONTRACT_BILLING,
  ];

  // Simulação de diferentes estágios de progresso
  const progressScenarios = [
    // cliente 0: proposta aceita + preparação concluída + assinatura em andamento
    { completedSteps: 3, currentStepInProgress: true },
    // cliente 1: apenas proposta aceita
    { completedSteps: 1, currentStepInProgress: false },
    // cliente 2: tudo concluído
    { completedSteps: 5, currentStepInProgress: false },
    // cliente 3: proposta aceita + preparação em andamento (atrasado)
    { completedSteps: 1, currentStepInProgress: true, forceDelay: true },
    // cliente 4: proposta + preparação concluídas + assinatura concluída + cadastro em andamento
    { completedSteps: 4, currentStepInProgress: true },
  ];

  for (let i = 0; i < customers.length; i++) {
    const customerData = customers[i];
    const dealData = deals[i];
    const scenario = progressScenarios[i];
    const proposalDate = new Date();
    proposalDate.setDate(proposalDate.getDate() - dealData.daysAgo);

    const customer = await prisma.customer.upsert({
      where: { id: `mock-customer-${i + 1}` },
      update: {},
      create: { id: `mock-customer-${i + 1}`, ...customerData },
    });

    const externalDealId = `mock-deal-${i + 1}`;
    const existingDeal = await prisma.pipedriveDeal.findUnique({ where: { externalDealId } });
    if (existingDeal) continue;

    const deal = await prisma.pipedriveDeal.create({
      data: {
        externalDealId,
        title: dealData.title,
        value: dealData.value,
        currency: 'BRL',
        stageName: 'Proposta aceita',
        stageId: '1',
        customerId: customer.id,
        rawPayload: { mock: true },
      },
    });

    const tracking = await prisma.contractTracking.create({
      data: {
        customerId: customer.id,
        pipedriveDealId: deal.id,
        currentStep: stepOrder[Math.min(scenario.completedSteps, stepOrder.length - 1)],
        overallStatus: scenario.completedSteps === 5 ? 'COMPLETED' : scenario.forceDelay ? 'DELAYED' : 'IN_PROGRESS',
        assignedUserId: i % 2 === 0 ? adminId : operatorId,
        proposalAcceptedAt: proposalDate,
        completedAt: scenario.completedSteps === 5 ? new Date() : null,
      },
    });

    // Cria as etapas conforme o cenário
    for (let s = 0; s < stepOrder.length; s++) {
      const stepName = stepOrder[s];
      const isCompleted = s < scenario.completedSteps;
      const isCurrent = s === scenario.completedSteps && scenario.currentStepInProgress;
      const stepDate = new Date(proposalDate);
      stepDate.setDate(stepDate.getDate() + s);

      let status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DELAYED' = 'PENDING';
      if (isCompleted) status = 'COMPLETED';
      else if (isCurrent) status = scenario.forceDelay ? 'DELAYED' : 'IN_PROGRESS';

      const dueDate = new Date(stepDate);
      dueDate.setDate(dueDate.getDate() + 1);

      await prisma.contractStep.create({
        data: {
          contractTrackingId: tracking.id,
          stepName,
          stepOrder: s + 1,
          status,
          startedAt: isCompleted || isCurrent ? stepDate : null,
          dueAt: !isCompleted && s > 0 ? (scenario.forceDelay ? new Date(Date.now() - 86400000) : dueDate) : null,
          completedAt: isCompleted ? stepDate : null,
          assignedUserId: i % 2 === 0 ? adminId : operatorId,
        },
      });
    }

    console.log(`Mock criado: ${customer.name} - ${dealData.title}`);
  }
}

main()
  .catch((e) => {
    console.error('Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
