use std::{env, fs, process};

use dolby_vision::rpu::dovi_rpu::DoviRpu;

fn main() {
    if let Err(error) = run() {
        eprintln!("AV1 T.35 RPU conversion failed: {error:#}");
        process::exit(1);
    }
}

fn run() -> anyhow::Result<()> {
    let mut args = env::args().skip(1);
    let input = args.next().ok_or_else(|| anyhow::anyhow!("missing input path"))?;
    let output = args.next().ok_or_else(|| anyhow::anyhow!("missing output path"))?;
    let reference = args.next();
    if args.next().is_some() {
        anyhow::bail!("unexpected extra arguments");
    }

    let payload = fs::read(input)?;
    let parsed = DoviRpu::parse_itu_t35_dovi_metadata_obu(&payload)?;
    if let Some(reference_path) = reference {
        // Match dovi_tool's own AV1 fixture contract: upstream reference is
        // Annex-B (4-byte start code + 2-byte HEVC NAL header), while the
        // serializer returns the HEVC NAL unit without the start code.
        let expected = fs::read(reference_path)?;
        if expected.get(4..) != nalu.get(2..) {
            anyhow::bail!("AV1 T.35 RPU does not match the upstream HEVC RPU reference");
        }
    }
    let profile = parsed.dovi_profile;
    let nalu = parsed.write_hevc_unspec62_nalu()?;
    let last_nonzero = nalu.iter().rposition(|byte| *byte != 0);
    if nalu.len() < 27 || !nalu.starts_with(&[0x7c, 0x01]) ||
        last_nonzero.map(|index| nalu[index]) != Some(0x80) {
        anyhow::bail!("libdovi returned an invalid HEVC UNSPEC62 RPU NAL unit");
    }
    fs::write(output, &nalu)?;
    println!(
        "{{\"profile\":{profile},\"rpuByteLength\":{}}}",
        nalu.len()
    );
    Ok(())
}
