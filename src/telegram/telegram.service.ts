import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { Context, Markup } from 'telegraf';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Question } from '../entities/question.entity';
import { AnswerOption } from '../entities/answer-option.entity';
import { TestResult } from '../entities/test-result.entity';

@Injectable()
export class TelegramService implements OnModuleInit {
  constructor(
    @InjectBot("Career_XBot") private bot: Telegraf<Context>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(Question) private qRepo: Repository<Question>,
    @InjectRepository(AnswerOption) private aoRepo: Repository<AnswerOption>,
    @InjectRepository(TestResult) private trRepo: Repository<TestResult>,
  ) {}

  async onModuleInit() {
    // setup handlers
    this.bot.start(async ctx => {
      const tgId = String(ctx.from.id);
      let user = await this.usersRepo.findOne({ where: { telegramId: tgId } });
      if (!user) {
        user = this.usersRepo.create({ telegramId: tgId });
        await this.usersRepo.save(user);
      }
      await ctx.reply(
        `Привет! Я бот для прохождения теста на подбор профессии. Сначала зарегистрируем тебя.\nОтправь команду /register`
      );
    });

    this.bot.command('register', async ctx => {
      const tgId = String(ctx.from.id);
      const user = await this.ensureUser(tgId);
      user.session = { step: 'ask_firstname' };
      await this.usersRepo.save(user);
      await ctx.reply('Напиши своё имя:');
    });

    this.bot.command('test', async ctx => {
      const tgId = String(ctx.from.id);
      const user = await this.ensureUser(tgId);
      if (!user.firstName || !user.phone) {
        user.session = { step: 'ask_firstname' };
        await this.usersRepo.save(user);
        return ctx.reply('Сначала зарегистрируйся. Напиши имя:');
      }

      const questions = await this.qRepo.find({ relations: ['options'] });
      if (!questions.length) {
        return ctx.reply('Вопросы не найдены. Обратитесь к администратору.');
      }

      // init session state
      user.session = {
        step: 'in_test',
        index: 0,
        answers: []
      };
      await this.usersRepo.save(user);
      return this.sendQuestion(ctx, user, questions[0]);
    });

    // generic text handler for registration and test flow
    this.bot.on('text', async ctx => {
      const tgId = String(ctx.from.id);
      const user = await this.ensureUser(tgId);
      const txt: string = ctx.message.text;
      if (txt.startsWith('/')) return;

      // registration flow
      if (user.session?.step === 'ask_firstname') {
        user.firstName = txt;
        user.session.step = 'ask_lastname';
        await this.usersRepo.save(user);
        return ctx.reply('Фамилия:');
      }
      if (user.session?.step === 'ask_lastname') {
        user.lastName = txt;
        user.session.step = 'ask_phone';
        await this.usersRepo.save(user);
        return ctx.reply('Номер телефона (например +7701xxxxxxx):');
      }
      if (user.session?.step === 'ask_phone') {
        user.phone = txt;
        user.session = null;
        await this.usersRepo.save(user);
        return ctx.reply('Регистрация завершена. Чтобы пройти тест, отправь /test');
      }

      // if not in registration, maybe user is mid-test
      if (user.session?.step === 'in_test') {
        return ctx.reply('Пожалуйста, используй кнопки для ответа.');
      }

      // other text
      await ctx.reply('Не понял. Доступные команды: /register, /test, /history');
    });

    // inline keyboard actions for options
    this.bot.on('callback_query', async (ctx) => {
      const data = ctx.callbackQuery['data']; // e.g. "answer:12"
      const tgId = String(ctx.from.id);
      const user = await this.ensureUser(tgId);
      if (!user.session || user.session.step !== 'in_test') {
        await ctx.answerCbQuery('Сначала начни тест командой /test');
        return;
      }

      if (data?.startsWith('answer:')) {
        const optionId = Number(data.split(':')[1]);
        const option = await this.aoRepo.findOne({ where: { id: optionId }, relations: ['question'] });
        if (!option) {
          await ctx.answerCbQuery('Опция не найдена');
          return;
        }

        // record answer
        user.session.answers.push({ questionId: option.question.id, optionId: option.id });
        user.session.index += 1;

        // fetch all questions
        const questions = await this.qRepo.find({ relations: ['options'] });

        if (user.session.index >= questions.length) {
          // finish test
          const answers = user.session.answers;
          const result = await this.calculateProfession(answers);
          const tr = this.trRepo.create({
            user,
            answers,
            profession: result.profession || 'Generalist', // если undefined, ставим "Generalist"
            professionDescription: result.description || 'Описание отсутствует.' // если undefined
          });
          await this.trRepo.save(tr);

          user.session = null;
          await this.usersRepo.save(user);

          await ctx.editMessageText(`Тест завершён.\nВам подходит: *${result.profession}*\n\n${result.description}`, { parse_mode: 'Markdown' });
          return;
        } else {
          // next question
          const nextQ = questions[user.session.index];
          await this.usersRepo.save(user);
          await ctx.editMessageReplyMarkup(undefined); // remove old keyboard
          return this.sendQuestion(ctx, user, nextQ);
        }
      } else {
        await ctx.answerCbQuery('Неизвестное действие');
      }
    });

    this.bot.command('history', async ctx => {
      const tgId = String(ctx.from.id);
      const user = await this.ensureUser(tgId);
      const results = await this.trRepo.find({ where: { user: { id: user.id } }, relations: ['user'], order: { createdAt: 'DESC' } });
      if (!results.length) {
        return ctx.reply('История пуста — пройдите тест хотя бы раз (/test).');
      }
      let text = 'Ваша история результатов:\n\n';
      for (const r of results) {
        text += `${r.createdAt.toLocaleString()} — ${r.profession}\n`;
      }
      return ctx.reply(text);
    });

    // seed questions if empty
    await this.seedQuestionsIfEmpty();
  }

  private async ensureUser(tgId: string) {
    let user = await this.usersRepo.findOne({ where: { telegramId: tgId } });
    if (!user) {
      user = this.usersRepo.create({ telegramId: tgId });
      await this.usersRepo.save(user);
    }
    return user;
  }

  private async sendQuestion(ctx, user: User, question: Question) {
    // send question with inline keyboard of options
    const options = question.options || (await this.aoRepo.find({ where: { question: { id: question.id } } }));
    const keyboard = options.map(o => [Markup.button.callback(o.text, `answer:${o.id}`)]);
    if (ctx.editMessageText) {
      // called from callback context
      await ctx.reply(question.text, Markup.inlineKeyboard(keyboard));
    } else {
      await ctx.reply(question.text, Markup.inlineKeyboard(keyboard));
    }
  }

  // simple algorithm: sum scores across chosen options; pick max category => profession
  private async calculateProfession(answers: { questionId: number; optionId: number }[]) {
    const categoryScores: Record<string, number> = {};
    for (const a of answers) {
      const opt = await this.aoRepo.findOne({ where: { id: a.optionId } });
      if (opt && opt.scores) {
        for (const [cat, val] of Object.entries(opt.scores)) {
          categoryScores[cat] = (categoryScores[cat] || 0) + Number(val ?? 0);
        }
      }
    }

    const sorted = Object.entries(categoryScores).sort((a, b) => b[1] - a[1]);
    const top = sorted[0];

    // защита на случай пустого результата
    if (!top || !top[0]) {
      return { profession: 'Generalist', description: 'Ни одна категория явно не выделилась.' };
    }

    const cat = top[0];

    const map = {
      data: { profession: 'Аналитик данных', description: 'Работа с данными, SQL, визуализацией и метриками.' },
      data2: { profession: 'Бизнес-аналитик', description: 'Анализ бизнес-данных, отчеты, KPI.' },
      dev: { profession: 'Разработчик', description: 'Писать код, архитектура, автоматизация.' },
      dev2: { profession: 'Backend-разработчик', description: 'Серверная логика, API, базы данных.' },
      design: { profession: 'UX/UI дизайнер', description: 'Дизайн интерфейсов и пользовательский опыт.' },
      design2: { profession: 'Графический дизайнер', description: 'Иллюстрации, визуальные концепции.' },
      qa: { profession: 'QA инженер', description: 'Тестирование, автоматизация тестов, контроль качества.' },
      qa2: { profession: 'Тестировщик автоматизации', description: 'Написание автотестов, контроль багов.' }
    };


    const profChoices = [map[cat], map[`${cat}2`]].filter(Boolean);
    return profChoices[Math.floor(Math.random() * profChoices.length)];
  }


  private async seedQuestionsIfEmpty() {
    const count = await this.qRepo.count();
    if (count > 0) return;

    const q1 = this.qRepo.create({
      text: 'Какой тип задач тебе нравится больше?',
      options: [
        { text: 'Анализ данных, таблицы, отчёты', scores: { data: 2 } },
        { text: 'Писать код, решать алгоритмы', scores: { dev: 2 } },
        { text: 'Делать интерфейсы и прототипы', scores: { design: 2 } },
        { text: 'Проверять программы, тесты', scores: { qa: 2 } },
      ],
    });
    const q2 = this.qRepo.create({
      text: 'Что доставляет удовольствие?',
      options: [
        { text: 'Разбирать большие наборы данных', scores: { data: 2 } },
        { text: 'Оптимизировать и строить архитектуру', scores: { dev: 2 } },
        { text: 'Работать с визуальной частью', scores: { design: 2 } },
        { text: 'Искать баги и ломать систему', scores: { qa: 2 } },
      ],
    });
    const q3 = this.qRepo.create({
      text: 'Какой инструмент хочешь изучать?',
      options: [
        { text: 'SQL / Python для данных', scores: { data: 2 } },
        { text: 'Node / TypeScript / Frameworks', scores: { dev: 2 } },
        { text: 'Figma / Sketch', scores: { design: 2 } },
        { text: 'Selenium / Playwright', scores: { qa: 2 } },
      ],
    });
    const q4 = this.qRepo.create({
      text: 'Ты любишь работать:',
      options: [
        { text: 'С числами и метриками', scores: { data: 2 } },
        { text: 'С кодом и продуктом', scores: { dev: 2 } },
        { text: 'С визуальными решениями', scores: { design: 2 } },
        { text: 'С качеством и тестами', scores: { qa: 2 } },
      ],
    });
    const q5 = this.qRepo.create({
      text: 'Какой рабочий ритм тебе ближе?',
      options: [
        { text: 'Аналитические исследования', scores: { data: 2 } },
        { text: 'Проекты и релизы', scores: { dev: 2 } },
        { text: 'Дизайн-спринты', scores: { design: 2 } },
        { text: 'Тест-кейсы и выпуск багфиксов', scores: { qa: 2 } },
      ],
    });

    await this.qRepo.save([q1, q2, q3, q4, q5]);
    // AnswerOption будут автоматически сохранены благодаря cascade
    console.log('Seeded sample questions');
  }
}
