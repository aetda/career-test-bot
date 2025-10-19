import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { AnswerOption } from './answer-option.entity';

@Entity()
export class Question {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  text: string;

  @OneToMany(() => AnswerOption, ao => ao.question, { cascade: true })
  options: AnswerOption[];
}
