import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { User } from './user.entity';

@Entity()
export class TestResult {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, u => u.results)
  user: User;

  @Column({ type: 'jsonb' })
  answers: { questionId: number; optionId: number }[];

  @Column()
  profession: string;

  @Column({ type: 'text', nullable: true })
  professionDescription: string;

  @CreateDateColumn()
  createdAt: Date;
}
