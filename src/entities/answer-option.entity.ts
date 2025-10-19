import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Question } from './question.entity';

@Entity()
export class AnswerOption {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  text: string;

  // scores: map category -> number, e.g. {"data":2,"dev":0,"design":1}
  @Column({ type: 'jsonb', default: {} })
  scores: Record<string, number>;

  @ManyToOne(() => Question, q => q.options)
  question: Question;
}
