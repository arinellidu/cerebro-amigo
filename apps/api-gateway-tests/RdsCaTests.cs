using ApiGateway.Data;
using Npgsql;
using Xunit;

namespace ApiGateway.Tests;

/// <summary>
/// Testes de unidade do upgrade SSL verify-full (DEBT T1-4) — sem banco.
/// Hosts RDS sobem para VerifyFull + Root Certificate; dev/CI (localhost,
/// Testcontainers) mantêm a connection string original.
/// </summary>
public sealed class RdsCaTests
{
    [Fact]
    public void HostLocal_MantemConnectionStringOriginal()
    {
        const string conn =
            "Host=localhost;Port=5432;Database=cerebro_v3;Username=u;Password=p;" +
            "SSL Mode=Require;Trust Server Certificate=true";

        Assert.Equal(conn, RdsCa.UpgradeToVerifyFull(conn));
    }

    [Fact]
    public void HostRds_SobeParaVerifyFull_ComRootCertificate()
    {
        const string conn =
            "Host=db.abc123.sa-east-1.rds.amazonaws.com;Port=5432;Database=cerebro_v3;" +
            "Username=u;Password=p;SSL Mode=Require;Trust Server Certificate=true";

        var csb = new NpgsqlConnectionStringBuilder(RdsCa.UpgradeToVerifyFull(conn));

        Assert.Equal(SslMode.VerifyFull, csb.SslMode);
        Assert.True(File.Exists(csb.RootCertificate));
        Assert.StartsWith(
            "-----BEGIN CERTIFICATE-----",
            File.ReadAllText(csb.RootCertificate!));
    }
}
