import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { TestResult } from './test-result.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  telegramId: string;

  @Column({ nullable: true })
  firstName: string;

  @Column({ nullable: true })
  lastName: string;

  @Column({ nullable: true })
  phone: string;

  @OneToMany(() => TestResult, tr => tr.user)
  results: TestResult[];

  @Column({ type: 'jsonb', nullable: true })
  session?: any; // временное хранилище состояния прохождения теста
}
