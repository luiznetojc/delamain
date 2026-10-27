namespace OrderPricing;

public interface IDiscountPolicy
{
    decimal ComputeDiscount(decimal subtotal, string customerTier);
}

public sealed class TieredDiscountPolicy : IDiscountPolicy
{
    public decimal ComputeDiscount(decimal subtotal, string customerTier)
    {
        if (subtotal < 0)
            throw new ArgumentOutOfRangeException(nameof(subtotal), "Subtotal cannot be negative.");

        return customerTier.Trim().ToUpperInvariant() switch
        {
            "GOLD" => Math.Round(subtotal * 0.15m, 2),
            "SILVER" => Math.Round(subtotal * 0.08m, 2),
            _ => 0m
        };
    }
}

public sealed class OrderPricingService(IDiscountPolicy discountPolicy)
{
    public decimal CalculateFinalTotal(decimal subtotal, string customerTier, decimal taxRate = 0.10m)
    {
        var discount = discountPolicy.ComputeDiscount(subtotal, customerTier);
        var discounted = Math.Max(0m, subtotal - discount);
        var tax = Math.Round(discounted * taxRate, 2);
        return discounted + tax;
    }
}
