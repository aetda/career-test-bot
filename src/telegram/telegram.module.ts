import { Module } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { TelegramService } from './telegram.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Question } from '../entities/question.entity';
import { AnswerOption } from '../entities/answer-option.entity';
import { TestResult } from '../entities/test-result.entity';

@Module({
  imports: [
    TelegrafModule,
    TypeOrmModule.forFeature([User, Question, AnswerOption, TestResult]),
  ],
  providers: [TelegramService],
})
export class TelegramModule {}
