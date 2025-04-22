export const getDummyStartAndEndDate = () => {
  const now = new Date();
  const startDate = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days from now
  const endDate = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
  return { startDate, endDate };
};
