import mockService from "../data/mock";

export async function seedOnce() {
  await mockService.seed();
}
