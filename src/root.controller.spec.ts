import { Test, TestingModule } from '@nestjs/testing';
import { RootController } from './root.controller';

describe('RootController', () => {
  let controller: RootController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RootController],
    }).compile();

    controller = module.get<RootController>(RootController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return API metadata with name, docs, and openapiJson', () => {
    const result = controller.index();
    expect(result).toEqual({
      name: 'Thalos API',
      docs: '/v1/docs',
      openapiJson: '/v1/docs-json',
    });
  });

  it('should return an object (not throw)', () => {
    expect(() => controller.index()).not.toThrow();
  });
});
