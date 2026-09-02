import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BuilderActionDto } from './builder.dto';

describe('BuilderActionDto', () => {
  it('accepts the UI-only label for compatibility with staggered deployments', async () => {
    const dto = plainToInstance(BuilderActionDto, { action: 'START_GUIDED', currentSlugs: [], label: 'Guiarme paso a paso' });
    expect(await validate(dto)).toHaveLength(0);
  });
});
