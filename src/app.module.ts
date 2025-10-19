import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegrafModule } from 'nestjs-telegraf';
import { TelegramModule } from './telegram/telegram.module';
import { User as User_1 } from './entities/user.entity';
import { Question } from './entities/question.entity';
import { AnswerOption } from './entities/answer-option.entity';
import { TestResult } from './entities/test-result.entity';
import * as dotenv from 'dotenv';
dotenv.config();

// Проверяем и сохраняем переменные в константы
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
if (!telegramToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is not defined in .env');
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not defined in .env');
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: databaseUrl, // <- теперь точно string
      entities: [User_1, Question, AnswerOption, TestResult],
      synchronize: true,
      logging: false,
    }),
    TelegrafModule.forRoot({
      token: telegramToken, // <- теперь точно string
      include: [TelegramModule],
      botName: 'Career_XBot'
    }),
    TelegramModule,
  ],
})
export class AppModule {}
