using Xunit;

namespace OrderPricing.Tests;

public sealed class OrderPricingServiceTests
{
    [Theory]
    [InlineData(100.00, "GOLD", 0.10, 93.50)]
    [InlineData(100.00, "SILVER", 0.10, 101.20)]
    [InlineData(100.00, "STANDARD", 0.10, 110.00)]
    public void CalculateFinalTotal_AppliesTierDiscountAndTax(
        decimal subtotal,
        string tier,
        decimal taxRate,
        decimal expectedTotal)
    {
        var service = new OrderPricingService(new TieredDiscountPolicy());
        var actual = service.CalculateFinalTotal(subtotal, tier, taxRate);
        Assert.Equal(expectedTotal, actual);
    }

    [Fact]
    public void CalculateFinalTotal_ThrowsOnNegativeSubtotal()
    {
        var service = new OrderPricingService(new TieredDiscountPolicy());
        Assert.Throws<ArgumentOutOfRangeException>(() => service.CalculateFinalTotal(-1m, "GOLD"));
    }
}
