// @ts-nocheck
// Core strategy calculation functions

export { BenefitPeriod, BenefitType } from './benefit-period';
export {
  classifyEarnerDependent,
  type EarnerDependentClassification,
} from './earner-dependent';
export {
  type CoupleFilingAgeResult,
  expectedNPVCouple,
  expectedNPVSingle,
  type FilingAgeResult,
} from './expected-npv';

export {
  PersonalBenefitPeriods,
  sumBenefitPeriods,
} from './recipient-personal-benefits';
export {
  calculateMonthlyDiscountRate,
  earliestFiling,
  optimalStrategyCouple,
  optimalStrategySingle,
  strategySumCentsCouple,
  strategySumCentsSingle,
  strategySumPeriodsCouple,
  strategySumPeriodsSingle,
  strategySumTotalPeriodsCouple,
  strategySumTotalPeriodsSingle,
} from './strategy-calc';
