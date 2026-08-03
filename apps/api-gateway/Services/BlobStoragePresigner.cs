using Azure.Storage.Blobs;
using Azure.Storage.Sas;

namespace ApiGateway.Services;

/// <summary>
/// SAS URLs de upload/download no Azure Blob Storage (ADR-082). O binário nunca
/// passa pelo gateway — o browser faz PUT/GET direto no Blob, mesmo padrão dos
/// presigned URLs do S3 que este serviço substitui (ADR-064/066/075).
///
/// Lazy: AZURE_STORAGE_CONNECTION_STRING só é lida no primeiro uso. Sem ela o
/// gateway sobe normal e apenas os endpoints de arquivo falham isolados
/// (exceção → 500), sem afetar o resto — comportamento idêntico ao do antigo
/// AmazonS3Client sem credenciais.
///
/// Limitações da SAS (registradas no DEBT T1-8): diferente do presign do S3,
/// a SAS não impõe Content-Type nem tamanho do upload. As allowlists de MIME
/// continuam nos endpoints; enforcement real de tamanho/tipo é pós-upload.
/// </summary>
public class BlobStoragePresigner
{
    private readonly Lazy<BlobServiceClient> _client;

    public BlobStoragePresigner(IConfiguration cfg)
    {
        _client = new Lazy<BlobServiceClient>(() =>
        {
            var conn = cfg["AZURE_STORAGE_CONNECTION_STRING"];
            if (string.IsNullOrWhiteSpace(conn))
                throw new InvalidOperationException(
                    "AZURE_STORAGE_CONNECTION_STRING ausente — storage de arquivos indisponível.");
            return new BlobServiceClient(conn);
        });
    }

    /// <summary>SAS de escrita (upload único; o browser envia x-ms-blob-type: BlockBlob).</summary>
    public string PresignPut(string container, string key, TimeSpan validade) =>
        Sas(container, key, BlobSasPermissions.Create | BlobSasPermissions.Write, validade);

    /// <summary>SAS de leitura (download/playback).</summary>
    public string PresignGet(string container, string key, TimeSpan validade) =>
        Sas(container, key, BlobSasPermissions.Read, validade);

    private string Sas(string container, string key, BlobSasPermissions perm, TimeSpan validade)
    {
        var blob = _client.Value.GetBlobContainerClient(container).GetBlobClient(key);
        // GenerateSasUri assina com a account key da connection string (shared key).
        return blob.GenerateSasUri(perm, DateTimeOffset.UtcNow.Add(validade)).ToString();
    }
}
